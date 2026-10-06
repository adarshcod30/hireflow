import { metricLine, type Logger } from '../shared/log';

export interface ProbeDeps {
  url: string;
  fetchImpl: typeof fetch;
  now(): number;
  emit(line: string): void;
  log: Logger;
  timeoutMs: number;
}

export interface ProbeResult {
  healthy: boolean;
  status: number | null;
  latencyMs: number;
}

/**
 * Runs every few minutes from outside the VPC and calls the API's readiness
 * endpoint, which checks the database. Whatever happens, it publishes
 * ApiHealthy as 1 or 0, so an alarm can tell "down" from "no data".
 *
 * It never throws: a failing probe is the signal, not a Lambda error.
 */
export function createProbeHandler(deps: ProbeDeps) {
  return async function handler(): Promise<ProbeResult> {
    const started = deps.now();
    let status: number | null = null;
    let healthy = false;
    try {
      const response = await deps.fetchImpl(deps.url, {
        signal: AbortSignal.timeout(deps.timeoutMs),
        headers: { 'user-agent': 'hireflow-probe' },
      });
      status = response.status;
      healthy = response.ok;
    } catch (error) {
      deps.log('warn', 'probe request failed', { error: error instanceof Error ? error.message : String(error) });
    }

    const latencyMs = deps.now() - started;
    deps.emit(metricLine('HireFlow', 'ApiHealthy', healthy ? 1 : 0));
    deps.emit(metricLine('HireFlow', 'ApiLatencyMs', latencyMs, 'Milliseconds'));
    if (!healthy) deps.log('warn', 'API is not healthy', { status, latencyMs });
    return { healthy, status, latencyMs };
  };
}
