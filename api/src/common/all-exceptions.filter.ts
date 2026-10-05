import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId?: string;
}

// Postgres error codes worth turning into a client error instead of a 500
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';
const PG_INVALID_TEXT_REPRESENTATION = '22P02';

/** UNAUTHORIZED / BAD_REQUEST become Unauthorized / Bad Request. */
const titleCase = (name: string): string =>
  name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/**
 * One error shape for the whole API, always carrying the request id so a user
 * can quote it and a log line can be found. Database constraint failures become
 * 4xx responses, and in production a 500 never reveals what went wrong inside.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<{
      status(code: number): { json(body: unknown): void };
    }>();
    const req = ctx.getRequest<{ id?: string | number }>();
    const requestId = req.id === undefined ? undefined : String(req.id);

    const body = this.describe(exception);
    if (body.statusCode >= 500) {
      this.logger.error({ err: exception, requestId }, 'unhandled error');
      if (this.config.nodeEnv === 'production') body.message = 'Internal server error';
    }
    res.status(body.statusCode).json({ ...body, requestId });
  }

  private describe(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      return {
        statusCode: status,
        error: titleCase(HttpStatus[status] ?? 'Error'),
        message,
      };
    }

    if (exception instanceof QueryFailedError) {
      const driver = exception.driverError as { code?: string; constraint?: string } | undefined;
      switch (driver?.code) {
        case PG_UNIQUE_VIOLATION:
          return {
            statusCode: 409,
            error: 'Conflict',
            message: `Already exists (${driver.constraint ?? 'unique constraint'})`,
          };
        case PG_FOREIGN_KEY_VIOLATION:
          return {
            statusCode: 409,
            error: 'Conflict',
            message: 'A referenced record does not exist or is still in use',
          };
        case PG_CHECK_VIOLATION:
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: `Value rejected (${driver.constraint ?? 'check'})`,
          };
        case PG_INVALID_TEXT_REPRESENTATION:
          return {
            statusCode: 400,
            error: 'Bad Request',
            message: 'A value has the wrong format',
          };
        default:
          break;
      }
    }

    const message = exception instanceof Error ? exception.message : 'Unknown error';
    return { statusCode: 500, error: 'Internal Server Error', message };
  }
}
