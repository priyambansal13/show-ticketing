import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser, Public, type AuthUser } from '../../common/auth/auth.decorators.js';
import { notFound } from '../../common/errors/domain.exception.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard.js';
import { ApiZodBody, ApiZodResponse, zodPipe } from '../../common/validation/zod.js';
import type { Env } from '../../config/env.js';
import { toPublicUser, UsersService } from '../users/users.service.js';
import { AuthService, type SessionResult } from './auth.service.js';
import {
  AuthResponseSchema,
  LoginSchema,
  PortalSchema,
  PublicUserSchema,
  RegisterCustomerSchema,
  RegisterManagerSchema,
  type Login,
  type Portal,
  type RegisterCustomer,
  type RegisterManager,
} from './dto/auth.dto.js';
import { assertAllowedOrigin, clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie.js';
import { TokenService } from './token.service.js';

const LOGIN_LIMIT = { scope: 'login', limit: 5, windowSeconds: 60, by: 'ip+email' } as const;
const REGISTER_LIMIT = { scope: 'register', limit: 3, windowSeconds: 60, by: 'ip' } as const;
const REFRESH_LIMIT = { scope: 'refresh', limit: 30, windowSeconds: 60, by: 'ip' } as const;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('customer/register')
  @Public()
  @RateLimit(REGISTER_LIMIT)
  @ApiOperation({ summary: 'Create a customer account and start a session' })
  @ApiZodBody(RegisterCustomerSchema)
  @ApiZodResponse(201, AuthResponseSchema)
  async registerCustomer(
    @Body(zodPipe(RegisterCustomerSchema)) body: RegisterCustomer,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond('customer', await this.auth.registerCustomer(body, this.meta(req)), res);
  }

  @Post('manager/register')
  @Public()
  @RateLimit(REGISTER_LIMIT)
  @ApiOperation({ summary: 'Create a manager account (PENDING_VERIFICATION until an admin approves it)' })
  @ApiZodBody(RegisterManagerSchema)
  @ApiZodResponse(201, AuthResponseSchema)
  async registerManager(
    @Body(zodPipe(RegisterManagerSchema)) body: RegisterManager,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond('manager', await this.auth.registerManager(body, this.meta(req)), res);
  }

  @Post(':portal/login')
  @Public()
  @HttpCode(200)
  @RateLimit(LOGIN_LIMIT)
  @ApiOperation({ summary: 'Sign in to the customer, manager or admin portal' })
  @ApiZodBody(LoginSchema)
  @ApiZodResponse(200, AuthResponseSchema)
  async login(
    @Param('portal', zodPipe(PortalSchema)) portal: Portal,
    @Body(zodPipe(LoginSchema)) body: Login,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(portal, await this.auth.login(portal, body, this.meta(req)), res);
  }

  @Post(':portal/refresh')
  @Public()
  @HttpCode(200)
  @RateLimit(REFRESH_LIMIT)
  @ApiOperation({ summary: 'Rotate the refresh cookie and get a new access token' })
  @ApiZodResponse(200, AuthResponseSchema)
  async refresh(@Param('portal', zodPipe(PortalSchema)) portal: Portal, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertAllowedOrigin(req, this.config.get('CORS_ORIGINS', { infer: true }));
    try {
      return this.respond(portal, await this.auth.refresh(portal, readRefreshCookie(req, portal), this.meta(req)), res);
    } catch (error) {
      clearRefreshCookie(res, portal, this.secureCookies);
      throw error;
    }
  }

  @Post(':portal/logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: 'End the session (revokes every token of this login)' })
  async logout(
    @Param('portal', zodPipe(PortalSchema)) portal: Portal,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    assertAllowedOrigin(req, this.config.get('CORS_ORIGINS', { infer: true }));
    await this.auth.logout(readRefreshCookie(req, portal));
    clearRefreshCookie(res, portal, this.secureCookies);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiZodResponse(200, PublicUserSchema)
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.users.findById(current.id);
    if (!user) throw notFound('User');
    return toPublicUser(user);
  }

  private respond(portal: Portal, result: SessionResult, res: Response) {
    setRefreshCookie(res, portal, result.refreshToken, this.secureCookies, this.tokens.refreshTtlMs);
    return result.response;
  }

  private get secureCookies(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }

  private meta(req: Request) {
    return { userAgent: req.headers['user-agent'], ip: req.ip };
  }
}
