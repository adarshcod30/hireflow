import { createHash, createHmac } from 'node:crypto';

/**
 * Request signing, identical to api/src/common/signing.ts.
 *
 *   signature = HMAC-SHA256(secret, `${timestamp}.${METHOD}.${pathAndQuery}.${sha256(body)}`)
 *
 * Both implementations are tested against the same reference vector so they
 * cannot drift apart unnoticed.
 */
export const SIGNATURE_HEADER = 'x-hireflow-signature';
export const TIMESTAMP_HEADER = 'x-hireflow-timestamp';

export function sign(secret: string, timestamp: string, method: string, pathAndQuery: string, body: string): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret)
    .update(`${timestamp}.${method.toUpperCase()}.${pathAndQuery}.${bodyHash}`)
    .digest('hex');
}
