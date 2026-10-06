// Lambda entry point: wires the real fetch and clock to the tested handler logic.
import { log } from '../shared/log';
import { requireEnv } from '../shared/secret';
import { createProbeHandler } from './handler';

let wired: ReturnType<typeof createProbeHandler> | undefined;

export const handler = () => {
  wired ??= createProbeHandler({
    url: requireEnv('PROBE_URL'),
    fetchImpl: fetch,
    now: () => Date.now(),
    emit: (line) => console.log(line),
    log,
    timeoutMs: 10_000,
  });
  return wired();
};
