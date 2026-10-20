import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role, UserStatus } from '../../generated/prisma/enums.js';

/** Authenticated principal, taken from the verified access token — never from the request body. */
export interface AuthUser {
  id: string;
  role: Role;
  status: UserStatus;
}

export const IS_PUBLIC = 'auth:isPublic';
export const ROLES = 'auth:roles';
export const ALLOW_PENDING = 'auth:allowPending';

/** Opt a route out of the global JwtAuthGuard. Every use is a reviewed exception. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route (or controller) to these roles. Non-ACTIVE accounts are rejected unless @AllowPending(). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Let PENDING_VERIFICATION managers reach this route (e.g. their own profile). */
export const AllowPending = () => SetMetadata(ALLOW_PENDING, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
