import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { KdcnRequest } from './auth/auth.types';

/**
 * Consistent JSON errors. Unexpected errors are logged with the request id and returned as a
 * generic 500 — internal details (SQL, stack traces) never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<KdcnRequest>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Something went wrong. Please try again.' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === 'string' ? { message: r } : (r as Record<string, unknown>);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        body = { message: 'This record already exists', code: 'DUPLICATE' };
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        body = { message: 'Not found' };
      } else if (exception.code === 'P2003') {
        status = HttpStatus.BAD_REQUEST;
        body = { message: 'A referenced record does not exist' };
      }
    } else if ((exception as { type?: string })?.type === 'entity.too.large') {
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      body = { message: 'Request too large' };
    }

    if (status >= 500) {
      this.logger.error(
        {
          msg: 'request.failed',
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          error: (exception as Error)?.message,
        },
        (exception as Error)?.stack,
      );
    }
    res.status(status).json({ statusCode: status, requestId: req.requestId, ...body });
  }
}
