import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const sqlDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../sql");
const client = new pg.Client({ connectionString: config.databaseUrl });

async function migrate() {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext('seatlock_schema_migrations'))");
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const filenames = (await readdir(sqlDirectory))
      .filter((filename) => /^\d+.*\.sql$/.test(filename))
      .sort();
    const applied = await client.query("SELECT filename FROM schema_migrations");
    const appliedFilenames = new Set(applied.rows.map((row) => row.filename));

    for (const filename of filenames) {
      if (appliedFilenames.has(filename)) continue;
      const sql = await readFile(resolve(sqlDirectory, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
        console.log(JSON.stringify({ event: "migration_applied", filename }));
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('seatlock_schema_migrations'))");
    await client.end();
  }
}

migrate().catch((error) => {
  console.error(JSON.stringify({
    event: "migration_failed",
    message: error instanceof Error ? error.message : "Unknown error",
  }));
  process.exit(1);
});
