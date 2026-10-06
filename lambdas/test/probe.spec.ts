import { createProbeHandler } from '../src/probe/handler';

function setup(fetchImpl: typeof fetch, clock: number[] = [1000, 1042]) {
  const emit = jest.fn();
  const log = jest.fn();
  const times = [...clock];
  const handler = createProbeHandler({
    url: 'https://api.example.com/health/ready',
    fetchImpl,
    now: () => times.shift() ?? 0,
    emit,
    log,
    timeoutMs: 5000,
  });
  const metrics = () => (emit.mock.calls as [string][]).map(([line]) => JSON.parse(line) as Record<string, number>);
  return { handler, emit, log, metrics };
}

describe('probe handler', () => {
  it('publishes ApiHealthy=1 and the latency when the API answers 200', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const t = setup(fetchImpl);

    expect(await t.handler()).toEqual({ healthy: true, status: 200, latencyMs: 42 });
    const [healthy, latency] = t.metrics();
    expect(healthy.ApiHealthy).toBe(1);
    expect(latency.ApiLatencyMs).toBe(42);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/health/ready',
      expect.objectContaining({ headers: { 'user-agent': 'hireflow-probe' } }),
    );
    expect(t.log).not.toHaveBeenCalled();
  });

  it('publishes 0 when readiness answers 503, for example because the database is down', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const t = setup(fetchImpl);

    expect(await t.handler()).toEqual({ healthy: false, status: 503, latencyMs: 42 });
    expect(t.metrics()[0].ApiHealthy).toBe(0);
    expect(t.log).toHaveBeenCalledWith('warn', 'API is not healthy', { status: 503, latencyMs: 42 });
  });

  it('publishes 0 instead of throwing when the request fails outright', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const t = setup(fetchImpl);

    expect(await t.handler()).toEqual({ healthy: false, status: null, latencyMs: 42 });
    expect(t.metrics()[0].ApiHealthy).toBe(0);
    expect(t.log).toHaveBeenCalledWith('warn', 'probe request failed', { error: 'getaddrinfo ENOTFOUND' });
  });

  it('logs why a request failed, not just that it did', async () => {
    const dnsMiss = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.example.com' },
    });
    const t = setup(jest.fn().mockRejectedValue(dnsMiss));
    await t.handler();
    expect(t.log).toHaveBeenCalledWith('warn', 'probe request failed', { error: 'fetch failed', reason: 'ENOTFOUND' });
  });

  it('falls back to the cause message, then to the error name, such as a timeout', async () => {
    const noCode = Object.assign(new Error('fetch failed'), { cause: { message: 'socket hang up' } });
    const a = setup(jest.fn().mockRejectedValue(noCode));
    await a.handler();
    expect(a.log).toHaveBeenCalledWith('warn', 'probe request failed', {
      error: 'fetch failed',
      reason: 'socket hang up',
    });

    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const b = setup(jest.fn().mockRejectedValue(timeout));
    await b.handler();
    expect(b.log).toHaveBeenCalledWith('warn', 'probe request failed', {
      error: 'The operation was aborted due to timeout',
      reason: 'TimeoutError',
    });
  });

  it('reports a thrown non-Error value as text', async () => {
    const fetchImpl = jest.fn().mockRejectedValue('boom');
    const t = setup(fetchImpl);
    await t.handler();
    expect(t.log).toHaveBeenCalledWith('warn', 'probe request failed', { error: 'boom' });
  });
});
