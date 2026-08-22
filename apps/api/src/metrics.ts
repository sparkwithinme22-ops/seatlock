type Labels = Record<string, string>;

const counters = new Map<string, number>();

function escapeLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function metricKey(name: string, labels: Labels) {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return name;
  return `${name}{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`;
}

export function incrementCounter(name: string, labels: Labels = {}, amount = 1) {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + amount);
}

export function renderMetrics() {
  const lines = [
    "# HELP seatlock_uptime_seconds API process uptime in seconds.",
    "# TYPE seatlock_uptime_seconds gauge",
    `seatlock_uptime_seconds ${process.uptime().toFixed(3)}`,
    "# HELP seatlock_process_resident_memory_bytes API resident memory in bytes.",
    "# TYPE seatlock_process_resident_memory_bytes gauge",
    `seatlock_process_resident_memory_bytes ${process.memoryUsage().rss}`,
  ];
  for (const [key, value] of [...counters.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`${key} ${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export function resetMetricsForTests() {
  counters.clear();
}

