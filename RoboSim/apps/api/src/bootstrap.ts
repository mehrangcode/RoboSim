import 'reflect-metadata';
import { DomainError } from '@robosim/shared';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import { genRequestId } from './common/request-id.js';
import type { Env } from './config/env.js';
import type { Database } from './db/client.js';

/** Builds the HTTP application; shared by `main.ts` and HTTP tests so both exercise the same pipeline. */
export async function createApp(env: Env, database: Database): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: env.TRUST_PROXY,
    genReqId: genRequestId,
    bodyLimit: 1_048_576,
    logger:
      env.LOG_LEVEL === 'silent'
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(env, database), adapter, {
    logger: env.LOG_LEVEL === 'silent' ? false : ['error', 'warn', 'log'],
    bufferLogs: false,
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter(env.PUBLIC_DOCS_URL));
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new DomainError('validation_failed', {
          errors: issues.map((i) => ({
            path: (i.path ?? []).map((p) => (typeof p === 'object' ? p.key : p)).join('.'),
            message: i.message,
          })),
        }),
    }),
  );
  app.enableShutdownHooks();

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('referrer-policy', 'no-referrer');
    if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
  });

  await app.init();
  return app;
}
