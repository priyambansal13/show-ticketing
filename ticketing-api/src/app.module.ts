import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter.js';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard.js';
import { LOG_REDACT_PATHS, resolveRequestId } from './common/request-id.js';
import { validateEnv, type Env } from './config/env.js';
import { MongoModule } from './infra/mongo/mongo.module.js';
import { KafkaModule } from './infra/kafka/kafka.module.js';
import { MetricsModule } from './infra/metrics/metrics.module.js';
import { OutboxModule } from './infra/outbox/outbox.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { JwtAuthGuard, RolesGuard } from './modules/auth/auth.guards.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BookingModule } from './modules/booking/booking.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { NotificationModule } from './modules/notification/notification.module.js';
import { PaymentModule } from './modules/payment/payment.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: (req, res) => {
            const id = resolveRequestId(req.headers['x-request-id']);
            res.setHeader('x-request-id', id);
            return id;
          },
          // Logged URLs never carry query strings (they may contain tokens).
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url.split('?')[0],
            }),
          },
          redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    PrismaModule,
    MongoModule,
    RedisModule,
    MetricsModule,
    OutboxModule,
    QueueModule,
    KafkaModule,
    HealthModule,
    AuditModule,
    AuthModule,
    AdminModule,
    EventsModule,
    BookingModule,
    PaymentModule,
    NotificationModule,
  ],
  providers: [
    // Order matters: authenticate → authorize → rate-limit (per-user limits need req.user).
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
