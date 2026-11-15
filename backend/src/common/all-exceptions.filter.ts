import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const isHttpError = exception instanceof HttpException;
    const status = isHttpError
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpError
      ? exception.getResponse()
      : 'Internal server error';
    if (!isHttpError) this.logger.error(exception);

    http
      .getResponse<Response>()
      .status(status)
      .json({
        statusCode: status,
        error: HttpStatus[status],
        message:
          typeof body === 'string'
            ? body
            : (body as { message: unknown }).message,
        path: http.getRequest<Request>().url,
        timestamp: new Date().toISOString(),
      });
  }
}
