import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_PENDING, IS_PUBLIC, ROLES, type AuthUser } from '../../common/auth/auth.decorators.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Role } from '../../generated/prisma/enums.js';
import { TokenService } from './token.service.js';

const unauthorized = () => new DomainException('UNAUTHORIZED', 'Authentication required', HttpStatus.UNAUTHORIZED);

/** Global: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    try {
      req.user = await this.tokens.verifyAccess(token);
    } catch {
      throw unauthorized();
    }
    return true;
  }
}

/** Global: enforces @Roles() and requires ACTIVE status on role-restricted routes. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (!roles) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw unauthorized();
    if (!roles.includes(user.role)) {
      throw new DomainException('FORBIDDEN', 'You do not have access to this resource', HttpStatus.FORBIDDEN);
    }
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING, targets);
    if (user.status !== 'ACTIVE' && !(allowPending && user.status === 'PENDING_VERIFICATION')) {
      throw new DomainException(
        'ACCOUNT_NOT_ACTIVE',
        user.status === 'PENDING_VERIFICATION' ? 'Your account is awaiting approval' : 'This account is suspended',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
