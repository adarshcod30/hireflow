import { sign } from '../src/shared/sign';

// The same vector as api/src/common/signing.spec.ts, computed independently with
// openssl and python. If either side's algorithm changes, one of the two tests fails.
describe('request signing (must match the API)', () => {
  const SECRET = 'a-shared-secret-of-sufficient-length-0123456789';

  it('matches the reference vector', () => {
    expect(sign(SECRET, '1790000000', 'POST', '/v1/internal/notifications/claim', '{"outboxId":"7"}')).toBe(
      'c507f597d26b4116e443793e578f644a844b3a17d2fd8994f787c6e1eccbf307',
    );
  });

  it('binds the method, path and body', () => {
    const base = sign(SECRET, '1', 'GET', '/a', '');
    expect(sign(SECRET, '1', 'get', '/a', '')).toBe(base);
    expect(sign(SECRET, '1', 'POST', '/a', '')).not.toBe(base);
    expect(sign(SECRET, '1', 'GET', '/b', '')).not.toBe(base);
    expect(sign(SECRET, '1', 'GET', '/a', 'x')).not.toBe(base);
    expect(sign(SECRET, '2', 'GET', '/a', '')).not.toBe(base);
  });
});
