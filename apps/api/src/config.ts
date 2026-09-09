import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

function requiredInProduction(name: string, developmentValue: string) {
  const value = process.env[name] ?? developmentValue;
  if (isProduction && !process.env[name]) {
    throw new Error(`${name} must be configured in production`);
  }
  return value;
}

const jwtSecret = requiredInProduction(
  "JWT_SECRET",
  "seatlock-local-development-secret",
);

const databaseUrl = requiredInProduction(
  "DATABASE_URL",
  "postgres://seatlock:seatlock@localhost:5432/seatlock",
);

function directDatabaseUrl(connectionString: string) {
  const url = new URL(connectionString);
  url.hostname = url.hostname.replace("-pooler.", ".");
  return url.toString();
}

if (isProduction && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters in production");
}

export const config = {
  environment: process.env.NODE_ENV ?? "development",
  databaseUrl,
  listenerDatabaseUrl: process.env.DATABASE_DIRECT_URL ?? directDatabaseUrl(databaseUrl),
  port: Number(process.env.PORT ?? 3001),
  jwtSecret,
  allowedOrigins: requiredInProduction("ALLOWED_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
  holdExpirationPollMs: Number(process.env.HOLD_EXPIRATION_POLL_MS ?? 5000),
  holdExpirationBatchSize: Number(process.env.HOLD_EXPIRATION_BATCH_SIZE ?? 100),
};
