import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, getToken, query, setToken, UNAUTHORIZED_EVENT } from '../api';
import { mockApi, Reply } from './helpers';

describe('api client', () => {
  it('sends JSON and parses the reply', async () => {
    const { calls } = mockApi({ 'POST /v1/echo': ({ body }: { body: unknown }) => ({ got: body }) });
    expect(await api('/v1/echo', { method: 'POST', body: { a: 1 } })).toEqual({ got: { a: 1 } });
    expect(calls[0].headers['Content-Type']).toBe('application/json');
  });

  it('sends no body headers on a GET, and no bearer token unless asked', async () => {
    setToken('secret-token');
    const { calls } = mockApi({ 'GET /v1/open': { ok: true } });
    await api('/v1/open');
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].headers['Content-Type']).toBeUndefined();
  });

  it('adds the bearer token on authenticated calls', async () => {
    setToken('secret-token');
    const { calls } = mockApi({ 'GET /v1/private': { ok: true } });
    await api('/v1/private', { auth: true });
    expect(calls[0].headers.Authorization).toBe('Bearer secret-token');
  });

  it('turns the API error shape into a readable ApiError with the request id', async () => {
    mockApi({ 'GET /v1/x': () => new Reply(409, { statusCode: 409, message: 'Already exists', requestId: 'req-9' }) });
    const error = await api('/v1/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: 'Already exists', requestId: 'req-9' });
  });

  it('joins a list of validation messages', async () => {
    mockApi({ 'POST /v1/x': () => new Reply(400, { message: ['email must be an email', 'fullName should not be empty'] }) });
    await expect(api('/v1/x', { method: 'POST', body: {} })).rejects.toThrow('email must be an email. fullName should not be empty');
  });

  it('copes with an error body that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
    await expect(api('/v1/x')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  });

  it('announces a 401 on an authenticated call so the app can sign out, but not on a public one', async () => {
    mockApi({ 'GET /v1/private': () => new Reply(401, { message: 'Invalid or expired token' }) });
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    await api('/v1/private', { auth: true }).catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    await api('/v1/private').catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('returns null for an empty successful body', async () => {
    mockApi({ 'DELETE /v1/x': () => new Reply(204, null) });
    expect(await api('/v1/x', { method: 'DELETE' })).toBeNull();
  });
});

describe('token storage', () => {
  it('keeps the token in sessionStorage only and can clear it', () => {
    setToken('abc');
    expect(getToken()).toBe('abc');
    expect(sessionStorage.getItem('hireflow.token')).toBe('abc');
    expect(localStorage.getItem('hireflow.token')).toBeNull();
    setToken(null);
    expect(getToken()).toBeNull();
  });
});

describe('query', () => {
  it('builds a query string and leaves out empty values', () => {
    expect(query({ q: 'react dev', cursor: '', limit: 10, status: undefined, x: null })).toBe('?q=react+dev&limit=10');
    expect(query({})).toBe('');
  });
});
