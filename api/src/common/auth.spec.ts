import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { loadConfig } from '../config/app-config';
import { UserEntity } from '../database/entities';
import { InternalSignatureGuard, JwtAuthGuard, RolesGuard } from './auth';
import { sign } from './signing';

const ctx = (req: Record<string, unknown>, handlerRoles?: string[]) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({ roles: handlerRoles }),
    getClass: () => class {},
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({
    secret: 'unit-test-secret-long-enough-to-sign',
    signOptions: { algorithm: 'HS256' },
  });
  const user = {
    id: 'u1',
    email: 'a@b.co',
    fullName: 'A',
    role: 'recruiter',
    isActive: true,
  } as UserEntity;
  const guard = (found: UserEntity | null) =>
    new JwtAuthGuard(jwt, {
      findOne: jest.fn().mockResolvedValue(found),
    } as never);
  const token = (payload: object) => jwt.signAsync({ sub: 'u1', typ: 'access', ...payload });

  it('attaches a safe view of the user and lets the request through', async () => {
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${await token({})}` },
    };
    expect(await guard(user).canActivate(ctx(req))).toBe(true);
    expect(req.user).toEqual({
      id: 'u1',
      email: 'a@b.co',
      fullName: 'A',
      role: 'recruiter',
    });
  });

  it.each([
    ['no header', {}],
    ['a non-bearer scheme', { authorization: 'Basic abc' }],
    ['garbage', { authorization: 'Bearer garbage' }],
  ])('refuses %s', async (_label, headers) => {
    await expect(guard(user).canActivate(ctx({ headers }))).rejects.toThrow(UnauthorizedException);
  });

  it('refuses a token of the wrong type, an unknown user and a deactivated one', async () => {
    const wrongType = {
      headers: {
        authorization: `Bearer ${await token({ typ: 'application' })}`,
      },
    };
    await expect(guard(user).canActivate(ctx(wrongType))).rejects.toThrow(UnauthorizedException);

    const valid = { headers: { authorization: `Bearer ${await token({})}` } };
    await expect(guard(null).canActivate(ctx(valid))).rejects.toThrow(UnauthorizedException);
    await expect(guard({ ...user, isActive: false }).canActivate(ctx(valid))).rejects.toThrow(UnauthorizedException);
  });

  it('refuses an expired token', async () => {
    const expired = await jwt.signAsync({ sub: 'u1', typ: 'access' }, { expiresIn: -5 });
    await expect(guard(user).canActivate(ctx({ headers: { authorization: `Bearer ${expired}` } }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('RolesGuard', () => {
  const reflector = (roles: string[] | undefined) => ({ getAllAndOverride: () => roles }) as unknown as Reflector;

  it('lets everyone through when no role is required', () => {
    expect(new RolesGuard(reflector(undefined)).canActivate(ctx({}))).toBe(true);
    expect(new RolesGuard(reflector([])).canActivate(ctx({}))).toBe(true);
  });

  it('lets a listed role through and refuses an unlisted or missing one', () => {
    const guard = new RolesGuard(reflector(['admin']));
    expect(guard.canActivate(ctx({ user: { role: 'admin' } }))).toBe(true);
    expect(() => guard.canActivate(ctx({ user: { role: 'recruiter' } }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx({}))).toThrow(ForbiddenException);
  });
});

describe('InternalSignatureGuard', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'x',
    INTERNAL_HMAC_SECRET: 'z'.repeat(40),
  });
  const guard = new InternalSignatureGuard(config);
  const now = () => String(Math.floor(Date.now() / 1000));

  const request = (headers: Record<string, string>, body = '') => ({
    headers,
    method: 'POST',
    originalUrl: '/v1/internal/x',
    rawBody: Buffer.from(body),
  });

  it('accepts a correctly signed request', () => {
    const ts = now();
    const sig = sign(config.internalHmacSecret, ts, 'POST', '/v1/internal/x', '{"a":1}');
    expect(
      guard.canActivate(ctx(request({ 'x-hireflow-timestamp': ts, 'x-hireflow-signature': sig }, '{"a":1}'))),
    ).toBe(true);
  });

  it('refuses missing headers, a non-hex signature and a wrong signature', () => {
    const ts = now();
    expect(() => guard.canActivate(ctx(request({})))).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(
        ctx(
          request({
            'x-hireflow-timestamp': ts,
            'x-hireflow-signature': 'zz!',
          }),
        ),
      ),
    ).toThrow(UnauthorizedException);
    expect(() =>
      guard.canActivate(
        ctx(
          request({
            'x-hireflow-timestamp': ts,
            'x-hireflow-signature': 'ab'.repeat(32),
          }),
        ),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('treats a missing raw body as empty', () => {
    const ts = now();
    const sig = sign(config.internalHmacSecret, ts, 'POST', '/v1/internal/x', '');
    const req = {
      headers: { 'x-hireflow-timestamp': ts, 'x-hireflow-signature': sig },
      method: 'POST',
      originalUrl: '/v1/internal/x',
    };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });
});
