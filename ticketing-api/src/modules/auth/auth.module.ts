import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { AuditModule } from '../audit/audit.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { JwtAuthGuard, RolesGuard } from './auth.guards.js';
import { AuthService } from './auth.service.js';
import { JWT_AUDIENCE, JWT_ISSUER, TokenService } from './token.service.js';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
        verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtAuthGuard, RolesGuard],
  exports: [TokenService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
