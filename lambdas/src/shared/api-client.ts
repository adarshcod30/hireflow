import type { SecretReader } from './secret';
import { SIGNATURE_HEADER, sign, TIMESTAMP_HEADER } from './sign';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** What the handlers need from the API, so tests can supply a fake. */
export interface InternalApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Calls the API's /internal endpoints, signing every request with the shared secret. */
export class ApiClient implements InternalApi {
  constructor(
    private readonly baseUrl: string,
    private readonly getSecret: SecretReader,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = () => Date.now(),
    private readonly timeoutMs = 8000,
  ) {}

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, JSON.stringify(body));
  }

  async delete(path: string): Promise<void> {
    await this.request('DELETE', path);
  }

  /**
   * A 401 can mean the shared secret was rotated while this container was warm. Read the secret
   * again and try once more. Only one retry: a second 401 is a real rejection, not a stale cache.
   */
  private async request<T>(method: string, path: string, body = '', refreshed = false): Promise<T> {
    const timestamp = String(Math.floor(this.now() / 1000));
    const secret = await this.getSecret(refreshed);
    const headers: Record<string, string> = {
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: sign(secret, timestamp, method, path, body),
    };
    if (body) headers['content-type'] = 'application/json';

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 401 && !refreshed) return this.request<T>(method, path, body, true);
    if (!res.ok) throw new ApiError(res.status, `${method} ${path} answered ${res.status}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
