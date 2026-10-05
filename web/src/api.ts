export class ApiError extends Error {
  status: number;
  requestId?: string;

  constructor(status: number, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

const TOKEN_KEY = 'hireflow.token';
export const UNAUTHORIZED_EVENT = 'hireflow:unauthorized';

// The access token lives in sessionStorage: it survives a reload but not a closed tab,
// and it is never sent anywhere except the API.
export const getToken = (): string | null => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null): void => {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
};

export const apiBase = (): string => (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send the bearer token. Public endpoints leave it off. */
  auth?: boolean;
  headers?: Record<string, string>;
}

/** The API sends one error shape; turn it into a readable message. */
function messageOf(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const m = (body as { message?: unknown }).message;
    if (Array.isArray(m)) return m.map(String).join('. ');
    if (typeof m === 'string') return m;
  }
  return `Request failed (${status})`;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = 'GET', body, auth = false, headers = {} } = options;
  const token = auth ? getToken() : null;

  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    // A 401 on a signed-in request means the token expired: tell the app to sign out
    if (res.status === 401 && auth) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const requestId =
      typeof parsed === 'object' && parsed !== null
        ? ((parsed as { requestId?: string }).requestId ?? undefined)
        : undefined;
    throw new ApiError(res.status, messageOf(parsed, res.status), requestId);
  }
  return parsed as T;
}

/** Build a query string, leaving out empty values. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
