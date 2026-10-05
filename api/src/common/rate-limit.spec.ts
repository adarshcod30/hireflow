import { rateLimit } from './rate-limit';

describe('rateLimit', () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_TEST;
  });

  it('reads the environment when asked, not when the module loads', () => {
    const limit = rateLimit('RATE_LIMIT_TEST', 5);
    expect(limit()).toBe(5);
    process.env.RATE_LIMIT_TEST = '9';
    expect(limit()).toBe(9);
  });

  it.each(['0', '-3', 'abc', ''])('falls back to the default for %p', (value) => {
    process.env.RATE_LIMIT_TEST = value;
    expect(rateLimit('RATE_LIMIT_TEST', 5)()).toBe(5);
  });
});
