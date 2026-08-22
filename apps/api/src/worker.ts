import { config } from "./config.js";
import { pool } from "./db.js";
import { expireHoldsBatch } from "./expiration.js";
import { incrementCounter } from "./metrics.js";

let running = false;
let shuttingDown = false;

async function sweepExpiredHolds() {
  if (running || shuttingDown) return;
  running = true;
  try {
    let expiredCount = 0;
    let batchSize = 0;
    do {
      const expired = await expireHoldsBatch(config.holdExpirationBatchSize);
      batchSize = expired.length;
      expiredCount += batchSize;
    } while (batchSize === config.holdExpirationBatchSize && !shuttingDown);

    if (expiredCount > 0) {
      incrementCounter("seatlock_holds_expired_total", {}, expiredCount);
      console.log(JSON.stringify({
        event: "seat_holds_expired",
        count: expiredCount,
        timestamp: new Date().toISOString(),
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: "hold_expiration_failed",
      message: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    }));
  } finally {
    running = false;
  }
}

console.log(`SeatLock expiration worker polling every ${config.holdExpirationPollMs}ms`);
void sweepExpiredHolds();
const timer = setInterval(sweepExpiredHolds, config.holdExpirationPollMs);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  while (running) await new Promise((resolve) => setTimeout(resolve, 10));
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
