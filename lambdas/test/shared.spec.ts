import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ApiClient, ApiError } from '../src/shared/api-client';
import { log, metricLine } from '../src/shared/log';
import { cachedSecret, requireEnv } from '../src/shared/secret';
import { sign } from '../src/shared/sign';

describe('ApiClient', () => {
  const SECRET = 'a-shared-secret-of-sufficient-length-0123456789';
  const now = () => 1_790_000_000_000;
  const respond = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });

  function client(fetchImpl: jest.Mock) {
    return new ApiClient('https://api.example.com', async () => SECRET, fetchImpl, now);
  }

  it('signs a GET over its method, path and query', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respond(200, { ok: true }));
    expect(await client(fetchImpl).get('/v1/internal/x?days=7')).toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.example.com/v1/internal/x?days=7');
    expect(init.method).toBe('GET');
    expect(init.headers['x-hireflow-timestamp']).toBe('1790000000');
    expect(init.headers['x-hireflow-signature']).toBe(sign(SECRET, '1790000000', 'GET', '/v1/internal/x?days=7', ''));
    expect(init.body).toBeUndefined();
  });

  it('signs a POST over the exact JSON it sends', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respond(200, { claimed: true }));
    await client(fetchImpl).post('/v1/internal/notifications/claim', { outboxId: '7' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.body).toBe('{"outboxId":"7"}');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['x-hireflow-signature']).toBe(
      sign(SECRET, '1790000000', 'POST', '/v1/internal/notifications/claim', '{"outboxId":"7"}'),
    );
  });

  it('supports DELETE with an empty 204 response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respond(204));
    await expect(client(fetchImpl).delete('/v1/internal/notifications/claim/7')).resolves.toBeUndefined();
  });

  it('turns an error status into an ApiError carrying it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respond(404));
    await expect(client(fetchImpl).get('/v1/internal/missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
    await expect(client(fetchImpl).get('/v1/internal/missing')).rejects.toBeInstanceOf(ApiError);
  });

  it('reads the secret again after a 401 and retries once, so a rotated key heals itself', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(respond(401))
      .mockResolvedValueOnce(respond(200, { ok: true }));
    const getSecret = jest.fn().mockResolvedValueOnce('old-secret').mockResolvedValueOnce('new-secret');
    const api = new ApiClient('https://api.example.com', getSecret, fetchImpl, now);

    expect(await api.get('/v1/internal/x')).toEqual({ ok: true });

    expect(getSecret.mock.calls).toEqual([[false], [true]]);
    const signatures = (fetchImpl.mock.calls as [string, { headers: Record<string, string> }][]).map(
      ([, init]) => init.headers['x-hireflow-signature'],
    );
    expect(signatures).toEqual([
      sign('old-secret', '1790000000', 'GET', '/v1/internal/x', ''),
      sign('new-secret', '1790000000', 'GET', '/v1/internal/x', ''),
    ]);
  });

  it('gives up after one retry when the 401 is genuine', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respond(401));
    await expect(client(fetchImpl).post('/v1/internal/x', {})).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry other failures', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respond(500));
    await expect(client(fetchImpl).get('/x')).rejects.toMatchObject({ status: 500 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('passes a timeout signal, so a hung API cannot hold a Lambda until it is killed', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respond(200, {}));
    await client(fetchImpl).get('/x');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe('cachedSecret', () => {
  const fakeClient = (send: jest.Mock) => ({ send }) as unknown as SecretsManagerClient;

  it('reads the secret once and reuses it', async () => {
    const send = jest.fn().mockResolvedValue({ SecretString: 's3cret' });
    const read = cachedSecret(fakeClient(send), 'arn:secret');
    expect(await read()).toBe('s3cret');
    expect(await read()).toBe('s3cret');
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0][0] as GetSecretValueCommand).input.SecretId).toBe('arn:secret');
  });

  it('reads again when asked to refresh, and keeps the new value', async () => {
    const send = jest.fn().mockResolvedValueOnce({ SecretString: 'old' }).mockResolvedValue({ SecretString: 'new' });
    const read = cachedSecret(fakeClient(send), 'arn:secret');
    expect(await read()).toBe('old');
    expect(await read(true)).toBe('new');
    expect(await read()).toBe('new');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failure, so the next invocation tries again', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('throttled')).mockResolvedValue({ SecretString: 'ok' });
    const read = cachedSecret(fakeClient(send), 'arn:secret');
    await expect(read()).rejects.toThrow('throttled');
    expect(await read()).toBe('ok');
  });

  it('rejects a secret with no string value', async () => {
    const read = cachedSecret(fakeClient(jest.fn().mockResolvedValue({})), 'arn:secret');
    await expect(read()).rejects.toThrow(/no string value/);
  });
});

describe('requireEnv and logging', () => {
  it('returns a set variable and names a missing one', () => {
    expect(requireEnv('X', { X: 'value' })).toBe('value');
    expect(() => requireEnv('X', {})).toThrow('X is not set');
    expect(() => requireEnv('X', { X: '' })).toThrow('X is not set');
  });

  it('writes one JSON line per event at the right console level', () => {
    const info = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    log('info', 'hello', { a: 1 });
    log('warn', 'careful');
    log('error', 'broken');
    expect(JSON.parse(info.mock.calls[0][0] as string)).toEqual({ level: 'info', message: 'hello', a: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('formats a CloudWatch embedded metric', () => {
    const line = JSON.parse(metricLine('HireFlow', 'StaleApplications', 4)) as {
      _aws: { CloudWatchMetrics: { Namespace: string; Metrics: { Name: string }[] }[] };
      StaleApplications: number;
    };
    expect(line.StaleApplications).toBe(4);
    expect(line._aws.CloudWatchMetrics[0]).toMatchObject({
      Namespace: 'HireFlow',
      Metrics: [{ Name: 'StaleApplications' }],
    });
  });
});
