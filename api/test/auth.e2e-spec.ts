import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { bearer, createUser, PASSWORD } from './helpers/factories';

describe('auth', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  describe('POST /v1/auth/login', () => {
    it('returns a bearer token and the user, never the password hash', async () => {
      const user = await createUser(t, 'recruiter');
      const res = await http().post('/v1/auth/login').send({ email: user.email, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({
        email: user.email,
        role: 'recruiter',
        isActive: true,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
    });

    it('matches the email regardless of case and surrounding spaces', async () => {
      const user = await createUser(t, 'recruiter');
      const res = await http()
        .post('/v1/auth/login')
        .send({ email: `  ${user.email.toUpperCase()} `, password: PASSWORD });
      expect(res.status).toBe(200);
    });

    it('answers a wrong password and an unknown email identically', async () => {
      // Different answers would let an attacker discover which emails have accounts
      const user = await createUser(t, 'recruiter');
      const wrong = await http().post('/v1/auth/login').send({ email: user.email, password: 'not-the-password' });
      const unknown = await http().post('/v1/auth/login').send({ email: 'nobody@hireflow.test', password: 'whatever' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('refuses a deactivated user even with the right password', async () => {
      const user = await createUser(t, 'recruiter', { isActive: false });
      const res = await http().post('/v1/auth/login').send({ email: user.email, password: PASSWORD });
      expect(res.status).toBe(401);
    });

    it.each([
      ['no body', {}],
      ['a malformed email', { email: 'not-an-email', password: 'x' }],
      ['an object instead of a string', { email: { $ne: '' }, password: 'x' }],
      ['an unknown extra field', { email: 'a@b.co', password: 'x', isAdmin: true }],
    ])('rejects %s with 400', async (_label, body) => {
      const res = await http().post('/v1/auth/login').send(body);
      expect(res.status).toBe(400);
    });
  });

  describe('bearer tokens', () => {
    it('lets a valid token read /v1/auth/me', async () => {
      const user = await createUser(t, 'admin');
      const res = await http().get('/v1/auth/me').set(bearer(user.token));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: user.id,
        email: user.email,
        role: 'admin',
      });
    });

    it('answers 401 with no token, a malformed header or garbage', async () => {
      expect((await http().get('/v1/auth/me')).status).toBe(401);
      expect((await http().get('/v1/auth/me').set('Authorization', 'Basic abc')).status).toBe(401);
      expect((await http().get('/v1/auth/me').set(bearer('garbage'))).status).toBe(401);
    });

    it('rejects a token signed with another secret and an unsigned one', async () => {
      const user = await createUser(t, 'recruiter');
      const forged = await new JwtService({
        secret: 'attacker-secret',
      }).signAsync({ sub: user.id, typ: 'access' });
      expect((await http().get('/v1/auth/me').set(bearer(forged))).status).toBe(401);

      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, typ: 'access' })}.`;
      expect((await http().get('/v1/auth/me').set(bearer(unsigned))).status).toBe(401);
    });

    it('rejects a token that is not an access token, such as an application token', async () => {
      const user = await createUser(t, 'recruiter');
      const jwt = t.app.get(JwtService);
      const wrongType = await jwt.signAsync({
        sub: user.id,
        typ: 'application',
      });
      expect((await http().get('/v1/auth/me').set(bearer(wrongType))).status).toBe(401);
    });

    it('rejects an expired token', async () => {
      const user = await createUser(t, 'recruiter');
      const expired = await t.app.get(JwtService).signAsync({ sub: user.id, typ: 'access' }, { expiresIn: -10 });
      expect((await http().get('/v1/auth/me').set(bearer(expired))).status).toBe(401);
    });

    it('stops working the moment the account is deactivated', async () => {
      const user = await createUser(t, 'recruiter');
      expect((await http().get('/v1/auth/me').set(bearer(user.token))).status).toBe(200);
      await t.db.query(`UPDATE users SET is_active = false WHERE id = $1`, [user.id]);
      expect((await http().get('/v1/auth/me').set(bearer(user.token))).status).toBe(401);
    });

    it('stops working if the user is deleted', async () => {
      const user = await createUser(t, 'recruiter');
      await t.db.query(`DELETE FROM users WHERE id = $1`, [user.id]);
      expect((await http().get('/v1/auth/me').set(bearer(user.token))).status).toBe(401);
    });
  });
});
