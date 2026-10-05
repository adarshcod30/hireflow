import { ArgumentsHost, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { loadConfig } from '../config/app-config';
import { AllExceptionsFilter } from './all-exceptions.filter';

const config = (nodeEnv: 'development' | 'production') => ({
  ...loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'x' }),
  nodeEnv,
});

function run(filter: AllExceptionsFilter, exception: unknown, req: { id?: string | number } = { id: 'req-1' }) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return {
    status: status.mock.calls[0][0] as number,
    body: json.mock.calls[0][0] as Record<string, unknown>,
  };
}

const pgError = (code: string, constraint?: string) =>
  new QueryFailedError('q', [], Object.assign(new Error('db'), { code, constraint }));

describe('AllExceptionsFilter', () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const dev = new AllExceptionsFilter(config('development'));
  const prod = new AllExceptionsFilter(config('production'));

  it.each([
    [new NotFoundException('Job not found'), 404, 'Not Found', 'Job not found'],
    [new ForbiddenException(), 403, 'Forbidden', 'Forbidden'],
    [
      new BadRequestException(['a must be a string', 'b is required']),
      400,
      'Bad Request',
      ['a must be a string', 'b is required'],
    ],
  ])('keeps the status and message of an HTTP exception', (exception, status, error, message) => {
    const out = run(dev, exception);
    expect(out.status).toBe(status);
    expect(out.body).toEqual({
      statusCode: status,
      error,
      message,
      requestId: 'req-1',
    });
  });

  it('turns database constraint failures into client errors', () => {
    expect(run(dev, pgError('23505', 'applications_job_candidate_key'))).toMatchObject({
      status: 409,
      body: {
        error: 'Conflict',
        message: 'Already exists (applications_job_candidate_key)',
      },
    });
    expect(run(dev, pgError('23503')).status).toBe(409);
    expect(run(dev, pgError('23514', 'fit_score_check'))).toMatchObject({
      status: 400,
    });
    expect(run(dev, pgError('22P02'))).toMatchObject({
      status: 400,
      body: { message: 'A value has the wrong format' },
    });
  });

  it('answers 500 for any other database error', () => {
    expect(run(dev, pgError('XX000')).status).toBe(500);
  });

  it('shows a developer the real message of an unexpected error', () => {
    expect(run(dev, new Error('boom: connection refused')).body.message).toBe('boom: connection refused');
  });

  it('shows production users nothing but a generic message, for errors and for non-errors alike', () => {
    expect(run(prod, new Error('postgres://user:secret@db')).body.message).toBe('Internal server error');
    expect(run(prod, 'a string was thrown').body.message).toBe('Internal server error');
    expect(run(prod, new NotFoundException('Job not found')).body.message).toBe('Job not found');
  });

  it('carries the request id when there is one and copes when there is not', () => {
    expect(run(dev, new Error('x'), { id: 42 }).body.requestId).toBe('42');
    expect(run(dev, new Error('x'), {}).body.requestId).toBeUndefined();
  });
});
