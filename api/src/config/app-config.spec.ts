import { loadConfig } from './app-config';

const GOOD_PROD: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db.internal:5432/hireflow',
  JWT_SECRET: 'f3c1d2e4a5b697887766554433221100ffeeddccbbaa99887766',
  INTERNAL_HMAC_SECRET: '0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f506172839',
  RESUME_BUCKET: 'hireflow-resumes',
  NOTIFICATIONS_QUEUE_URL: 'https://sqs.ap-south-1.amazonaws.com/123/notifications',
  WEB_ORIGINS: 'https://app.example.com',
};

describe('loadConfig', () => {
  describe('development and test', () => {
    it('needs only a database url, with safe local defaults', () => {
      const c = loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://x',
      });
      expect(c).toMatchObject({
        port: 3000,
        storageDriver: 'local',
        queueDriver: 'memory',
        outboxRelayEnabled: false,
        databaseSsl: false,
        enableDocs: true,
        webOrigins: ['http://localhost:5173'],
      });
    });

    it('invents long, different, random secrets so nothing is ever a value written in the source', () => {
      const a = loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://x',
      });
      const b = loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://x',
      });
      expect(a.jwtSecret.length).toBeGreaterThanOrEqual(32);
      expect(a.jwtSecret).not.toBe(a.internalHmacSecret);
      expect(a.jwtSecret).not.toBe(b.jwtSecret);
    });

    it('uses a cheap bcrypt cost in tests and the real one otherwise', () => {
      expect(loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'x' }).bcryptRounds).toBe(4);
      expect(loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'x' }).bcryptRounds).toBe(12);
      expect(
        loadConfig({
          NODE_ENV: 'development',
          DATABASE_URL: 'x',
          BCRYPT_ROUNDS: '10',
        }).bcryptRounds,
      ).toBe(10);
    });

    it('falls back to development for an unknown NODE_ENV and ignores junk numbers', () => {
      const c = loadConfig({
        NODE_ENV: 'staging',
        DATABASE_URL: 'x',
        PORT: 'abc',
      });
      expect(c.nodeEnv).toBe('development');
      expect(c.port).toBe(3000);
    });

    it('splits and trims a list of web origins', () => {
      expect(
        loadConfig({
          NODE_ENV: 'test',
          DATABASE_URL: 'x',
          WEB_ORIGINS: ' https://a.com , https://b.com ,',
        }).webOrigins,
      ).toEqual(['https://a.com', 'https://b.com']);
    });
  });

  describe('production', () => {
    it('accepts a complete configuration and switches to the real AWS adapters', () => {
      const c = loadConfig(GOOD_PROD);
      expect(c).toMatchObject({
        storageDriver: 's3',
        queueDriver: 'sqs',
        outboxRelayEnabled: true,
        databaseSsl: true,
        enableDocs: false,
      });
    });

    it('lists every problem at once instead of failing on the first', () => {
      expect.assertions(4);
      try {
        loadConfig({ NODE_ENV: 'production' });
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('DATABASE_URL is not set');
        expect(message).toContain('JWT_SECRET must be at least 32');
        expect(message).toContain('INTERNAL_HMAC_SECRET must be at least 32');
        expect(message).toContain('RESUME_BUCKET is not set');
      }
    });

    it.each([
      ['a short secret', 'short'],
      ['a placeholder', 'change-me-change-me-change-me-change-me-please'],
      ['an example value', 'example-secret-example-secret-example-secret'],
    ])('rejects %s for JWT_SECRET', (_label, secret) => {
      expect(() => loadConfig({ ...GOOD_PROD, JWT_SECRET: secret })).toThrow(/JWT_SECRET must be at least 32/);
    });

    it('rejects using one secret for both purposes', () => {
      expect(() =>
        loadConfig({
          ...GOOD_PROD,
          INTERNAL_HMAC_SECRET: GOOD_PROD.JWT_SECRET,
        }),
      ).toThrow(/must be different/);
    });

    it('rejects a wildcard CORS origin', () => {
      expect(() => loadConfig({ ...GOOD_PROD, WEB_ORIGINS: '*' })).toThrow(/WEB_ORIGINS must not contain \*/);
    });

    it('rejects an unknown driver name', () => {
      expect(() => loadConfig({ ...GOOD_PROD, STORAGE_DRIVER: 'ftp' })).toThrow(/STORAGE_DRIVER/);
      expect(() => loadConfig({ ...GOOD_PROD, QUEUE_DRIVER: 'rabbit' })).toThrow(/QUEUE_DRIVER/);
    });
  });
});
