import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { pool } from "./db.js";

export type DatabaseContext =
  | { accessMode: "public" }
  | { accessMode: "tenant"; organizerId: string };

export async function setDatabaseContext(
  client: PoolClient,
  context: DatabaseContext,
) {
  await client.query("SET LOCAL ROLE seatlock_app");
  await client.query(
    "SELECT set_config('app.access_mode', $1, true)",
    [context.accessMode],
  );
  await client.query(
    "SELECT set_config('app.organizer_id', $1, true)",
    [context.accessMode === "tenant" ? context.organizerId : ""],
  );
}

export async function withDatabaseContext<T>(
  context: DatabaseContext,
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setDatabaseContext(client, context);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function queryWithContext<T extends QueryResultRow = QueryResultRow>(
  context: DatabaseContext,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return withDatabaseContext(context, (client) => client.query<T>(text, values));
}

