import { resources } from '@robosim/i18n';
import {
  DomainError,
  ERROR_STATUS,
  negotiateLocale,
  type ErrorCode,
  type ProblemDetails,
} from '@robosim/shared';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  405: 'not_found',
  409: 'conflict',
  410: 'gone',
  412: 'precondition_failed',
  413: 'payload_too_large',
  415: 'validation_failed',
  429: 'rate_limited',
  503: 'maintenance',
};

/** Renders every error as RFC 9457 problem details with a stable code and a localized title (API Spec §3). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  constructor(private readonly docsUrl: string) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const { code, params } = this.classify(exception);
    const status = ERROR_STATUS[code];
    const locale = negotiateLocale(request.headers['accept-language']);

    if (status >= 500 && code !== 'maintenance') {
      this.logger.error({ err: exception, requestId: request.id }, 'Unhandled error');
    }

    const body: ProblemDetails = {
      type: `${this.docsUrl}/errors/${code}`,
      title: resources[locale].errors[code],
      status,
      code,
      instance: request.url.split('?')[0] ?? request.url,
      requestId: String(request.id),
      ...(params && Object.keys(params).length ? { params } : {}),
    };
    void reply.status(status).header('content-type', 'application/problem+json; charset=utf-8').send(body);
  }

  private classify(exception: unknown): { code: ErrorCode; params?: Record<string, unknown> } {
    if (exception instanceof DomainError) return { code: exception.code, params: exception.params };
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { code: STATUS_TO_CODE[status] ?? (status >= 500 ? 'internal_error' : 'validation_failed') };
    }
    const status = (exception as { statusCode?: unknown })?.statusCode;
    if (typeof status === 'number' && STATUS_TO_CODE[status]) return { code: STATUS_TO_CODE[status] };
    return { code: 'internal_error' };
  }
}
