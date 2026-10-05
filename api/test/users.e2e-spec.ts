import request from 'supertest';
import { createTestApp, TestApp } from './helpers/app';
import { bearer, createUser } from './helpers/factories';

describe('users', () => {
  let t: TestApp;
  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const newUser = (over: Record<string, unknown> = {}) => ({
    email: `new${Math.random().toString(36).slice(2)}@hireflow.test`,
    fullName: 'New Recruiter',
    password: 'a-long-enough-password',
    role: 'recruiter',
    ...over,
  });

  it('lets an admin create a recruiter who can then sign in', async () => {
    const admin = await createUser(t, 'admin');
    const body = newUser();
    const created = await http().post('/v1/users').set(bearer(admin.token)).send(body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      email: body.email,
      role: 'recruiter',
      isActive: true,
    });
    expect(created.body.passwordHash).toBeUndefined();

    const login = await http().post('/v1/auth/login').send({ email: body.email, password: body.password });
    expect(login.status).toBe(200);
  });

  it('is closed to recruiters and anonymous callers', async () => {
    const recruiter = await createUser(t, 'recruiter');
    expect((await http().post('/v1/users').send(newUser())).status).toBe(401);
    expect((await http().post('/v1/users').set(bearer(recruiter.token)).send(newUser())).status).toBe(403);
    expect((await http().get('/v1/users').set(bearer(recruiter.token))).status).toBe(403);
  });

  it('refuses a duplicate email, in any letter case, with 409', async () => {
    const admin = await createUser(t, 'admin');
    const body = newUser();
    await http().post('/v1/users').set(bearer(admin.token)).send(body);
    const again = await http()
      .post('/v1/users')
      .set(bearer(admin.token))
      .send({ ...body, email: body.email.toUpperCase() });
    expect(again.status).toBe(409);
  });

  it.each([
    ['a short password', { password: 'short' }],
    ['an invalid role', { role: 'superuser' }],
    ['a missing name', { fullName: '' }],
    ['an invalid email', { email: 'nope' }],
  ])('rejects %s with 400', async (_label, over) => {
    const admin = await createUser(t, 'admin');
    expect((await http().post('/v1/users').set(bearer(admin.token)).send(newUser(over))).status).toBe(400);
  });

  it('deactivates and reactivates a user, but never lets an admin lock themselves out', async () => {
    const admin = await createUser(t, 'admin');
    const recruiter = await createUser(t, 'recruiter');

    const off = await http()
      .patch(`/v1/users/${recruiter.id}/active`)
      .set(bearer(admin.token))
      .send({ isActive: false });
    expect(off.body.isActive).toBe(false);
    expect((await http().get('/v1/auth/me').set(bearer(recruiter.token))).status).toBe(401);

    const on = await http().patch(`/v1/users/${recruiter.id}/active`).set(bearer(admin.token)).send({ isActive: true });
    expect(on.body.isActive).toBe(true);
    expect((await http().get('/v1/auth/me').set(bearer(recruiter.token))).status).toBe(200);

    const self = await http().patch(`/v1/users/${admin.id}/active`).set(bearer(admin.token)).send({ isActive: false });
    expect(self.status).toBe(400);
  });

  it('answers 400 for a malformed id and 404 for an unknown one', async () => {
    const admin = await createUser(t, 'admin');
    expect(
      (await http().patch('/v1/users/not-a-uuid/active').set(bearer(admin.token)).send({ isActive: false })).status,
    ).toBe(400);
    expect(
      (
        await http()
          .patch('/v1/users/00000000-0000-4000-8000-000000000000/active')
          .set(bearer(admin.token))
          .send({ isActive: false })
      ).status,
    ).toBe(404);
  });
});
