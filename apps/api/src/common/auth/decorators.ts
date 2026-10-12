import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { AuthContext, KdcnRequest } from './auth.types';

export const IS_PUBLIC = 'kdcn:isPublic';
export const STAFF_ROLES = 'kdcn:staffRoles';
export const SKIP_CSRF = 'kdcn:skipCsrf';
export const ALLOW_UNVERIFIED_MFA = 'kdcn:allowUnverifiedMfa';

/** Route is reachable without a session (a session is still attached when present). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Route requires a KDCN staff user holding at least one of the given roles, with a
 * session that has passed MFA. SUPER_ADMIN always qualifies.
 */
export const Staff = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES, roles);

/** Server-to-server endpoints (provider webhooks) that are authenticated by signature. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/** Staff endpoints needed to complete MFA enrolment/verification. */
export const AllowUnverifiedMfa = () => SetMetadata(ALLOW_UNVERIFIED_MFA, true);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext | undefined => {
  return ctx.switchToHttp().getRequest<KdcnRequest>().auth;
});

/** Like CurrentAuth but guaranteed non-null (use on non-public routes). */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<KdcnRequest>().auth;
  if (!auth) throw new Error('Auth decorator used on a route without authentication');
  return auth;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  return ctx.switchToHttp().getRequest<KdcnRequest>().ip;
});
