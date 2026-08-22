import { beforeEach, describe, expect, it } from "vitest";
import { incrementCounter, renderMetrics, resetMetricsForTests } from "./metrics.js";

beforeEach(resetMetricsForTests);

describe("Prometheus metrics", () => {
  it("aggregates counters with stable labels", () => {
    incrementCounter("seatlock_http_requests_total", { status: "2xx", method: "GET" });
    incrementCounter("seatlock_http_requests_total", { method: "GET", status: "2xx" });
    expect(renderMetrics()).toContain(
      'seatlock_http_requests_total{method="GET",status="2xx"} 2',
    );
  });
});
