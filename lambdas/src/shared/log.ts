/** One JSON line per event, which CloudWatch Logs Insights can query by field. */
export type Level = 'info' | 'warn' | 'error';

export type Logger = (level: Level, message: string, fields?: Record<string, unknown>) => void;

export const log: Logger = (level, message, fields = {}) => {
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

/** CloudWatch Embedded Metric Format: a log line that CloudWatch turns into a metric, with no API call. */
export function metricLine(namespace: string, name: string, value: number, unit = 'Count'): string {
  return JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{ Namespace: namespace, Dimensions: [[]], Metrics: [{ Name: name, Unit: unit }] }],
    },
    [name]: value,
  });
}
