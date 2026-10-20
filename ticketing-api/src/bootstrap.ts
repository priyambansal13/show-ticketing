import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Redis } from 'ioredis';
import { requestContextMiddleware } from './common/context/request-context.js';
import { httpMetricsMiddleware } from './infra/metrics/http-metrics.middleware.js';
import { MetricsService } from './infra/metrics/metrics.service.js';
import type { Env } from './config/env.js';
import { REDIS } from './infra/redis/redis.module.js';
import { SocketIoAdapter } from './infra/socket/socket-io.adapter.js';

export const API_PREFIX = 'api/v1';

/**
 * HTTP wiring shared by main.ts and the integration tests, so tests exercise
 * the same prefix, security headers, CORS and docs as production.
 * The app must be created with `{ rawBody: true }` (payment webhook signatures).
 */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const express = app as NestExpressApplication;

  express.disable('x-powered-by');
  // Trust X-Forwarded-For only from the configured number of proxy hops; otherwise
  // clients could spoof their IP and evade per-IP rate limits.
  express.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  // HSTS and `upgrade-insecure-requests` are production-only: browsers apply HSTS to the whole
  // host, so sending it from http://localhost would force HTTPS on every local tool (mongo-express,
  // Mailpit, RedisInsight, the web app) and break them.
  const production = config.get('NODE_ENV', { infer: true }) === 'production';
  app.use(
    helmet({
      strictTransportSecurity: production,
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: production ? [] : null } },
    }),
  );
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.use(httpMetricsMiddleware(app.get(MetricsService)));

  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After'],
  });
  app.enableShutdownHooks();
  app.useWebSocketAdapter(
    new SocketIoAdapter(
      app,
      config.get('CORS_ORIGINS', { infer: true }),
      app.get<Redis>(REDIS),
      config.get('TRUST_PROXY_HOPS', { infer: true }),
    ),
  );

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Ticketing API')
        .setDescription('BookMyShow-style ticketing platform — customer, manager and admin APIs')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    // UI: /api/docs   JSON (used by ticketing-web `pnpm gen:api`): /api/docs-json
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
  }
}
