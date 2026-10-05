import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Request signing between the Lambda workers and the API.
 *
 * signature = HMAC-SHA256(secret, `${timestamp}.${METHOD}.${pathAndQuery}.${sha256(body)}`)
 *
 * Binding the method, path, query and body means a signature cannot be reused
 * for a different request, and the timestamp limits how long a captured one
 * stays useful. lambdas/shared/sign.ts implements the same function; both sides
 * are checked against the same test vector so they cannot drift apart.
 */
export const SIGNATURE_HEADER = 'x-hireflow-signature';
export const TIMESTAMP_HEADER = 'x-hireflow-timestamp';
export const MAX_SKEW_SECONDS = 300;

export function sign(secret: string, timestamp: string, method: string, pathAndQuery: string, body: string): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret)
    .update(`${timestamp}.${method.toUpperCase()}.${pathAndQuery}.${bodyHash}`)
    .digest('hex');
}

export function verify(
  secret: string,
  signature: string,
  timestamp: string,
  method: string,
  pathAndQuery: string,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(sign(secret, timestamp, method, pathAndQuery, body), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
