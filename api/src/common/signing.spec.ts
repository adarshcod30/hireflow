import { MAX_SKEW_SECONDS, sign, verify } from './signing';

const SECRET = 'a-shared-secret-of-sufficient-length-0123456789';
const TS = '1790000000';

describe('request signing', () => {
  // The Lambdas implement the same function independently (lambdas/shared/sign.ts).
  // Both sides are checked against this vector, so neither can drift without a test failing.
  // It was computed with openssl and python as well, not only with this code:
  //   printf '%s' "1790000000.POST./v1/internal/notifications/claim.$(printf '%s' '{"outboxId":"7"}' | openssl dgst -sha256 -hex | sed 's/^.* //')" | openssl dgst -sha256 -hmac "$SECRET"
  it('matches the reference vector', () => {
    expect(sign(SECRET, TS, 'POST', '/v1/internal/notifications/claim', '{"outboxId":"7"}')).toBe(
      'c507f597d26b4116e443793e578f644a844b3a17d2fd8994f787c6e1eccbf307',
    );
  });

  it('is deterministic and method-case-insensitive', () => {
    const a = sign(SECRET, TS, 'get', '/x', '');
    expect(sign(SECRET, TS, 'GET', '/x', '')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('verify', () => {
    const now = Number(TS);
    const good = () => sign(SECRET, TS, 'POST', '/v1/a?x=1', '{"a":1}');

    it('accepts the exact request', () => {
      expect(verify(SECRET, good(), TS, 'POST', '/v1/a?x=1', '{"a":1}', now)).toBe(true);
    });

    it.each([
      ['a different method', 'GET', '/v1/a?x=1', '{"a":1}'],
      ['a different path', 'POST', '/v1/b?x=1', '{"a":1}'],
      ['a different query', 'POST', '/v1/a?x=2', '{"a":1}'],
      ['a different body', 'POST', '/v1/a?x=1', '{"a":2}'],
      ['an empty body', 'POST', '/v1/a?x=1', ''],
    ])('rejects %s', (_label, method, path, body) => {
      expect(verify(SECRET, good(), TS, method, path, body, now)).toBe(false);
    });

    it('rejects the wrong secret and a signature of the wrong length', () => {
      expect(
        verify('another-secret-entirely-different-0123456789', good(), TS, 'POST', '/v1/a?x=1', '{"a":1}', now),
      ).toBe(false);
      expect(verify(SECRET, 'abcd', TS, 'POST', '/v1/a?x=1', '{"a":1}', now)).toBe(false);
      expect(verify(SECRET, '', TS, 'POST', '/v1/a?x=1', '{"a":1}', now)).toBe(false);
    });

    it(`enforces a ${MAX_SKEW_SECONDS} second window in both directions`, () => {
      expect(verify(SECRET, good(), TS, 'POST', '/v1/a?x=1', '{"a":1}', now + MAX_SKEW_SECONDS)).toBe(true);
      expect(verify(SECRET, good(), TS, 'POST', '/v1/a?x=1', '{"a":1}', now + MAX_SKEW_SECONDS + 1)).toBe(false);
      expect(verify(SECRET, good(), TS, 'POST', '/v1/a?x=1', '{"a":1}', now - MAX_SKEW_SECONDS - 1)).toBe(false);
    });

    it.each(['abc', '', '1.5', 'NaN', '1e9'])('rejects the timestamp %p', (ts) => {
      expect(verify(SECRET, sign(SECRET, ts, 'GET', '/x', ''), ts, 'GET', '/x', '', now)).toBe(false);
    });
  });
});
