import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { ApiError, type InternalApi } from '../src/shared/api-client';

export const APP_ID = '0a1b2c3d-0000-4000-8000-0123456789ab';

export const sqsEvent = (...bodies: unknown[]): SQSEvent => ({
  Records: bodies.map(
    (body, i) =>
      ({
        messageId: `msg-${i + 1}`,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }) as SQSRecord,
  ),
});

export const s3Event = (...keys: string[]) => ({
  Records: keys.map((key) => ({ s3: { bucket: { name: 'hireflow-resumes' }, object: { key } } })),
});

export const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.7 fake resume'));

/** A fake of the API: routes are matched by "METHOD path", unknown routes answer 404. */
export function fakeApi(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const handle = (method: string, path: string, body?: unknown): unknown => {
    calls.push({ method, path, body });
    const route = routes[`${method} ${path}`];
    if (route === undefined) throw new ApiError(404, `${method} ${path} answered 404`);
    return typeof route === 'function' ? (route as (b?: unknown) => unknown)(body) : route;
  };
  const api: InternalApi = {
    get: (path) => Promise.resolve(handle('GET', path) as never),
    post: (path, body) => Promise.resolve(handle('POST', path, body) as never),
    delete: (path) => {
      handle('DELETE', path);
      return Promise.resolve();
    },
  };
  return { api, calls };
}
