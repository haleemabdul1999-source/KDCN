import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole } from '@prisma/client';
import { SessionService } from './session.service';
import { CSRF_HEADER, KdcnRequest, SESSION_COOKIE } from './auth.types';
import { ALLOW_UNVERIFIED_MFA, IS_PUBLIC, SKIP_CSRF, STAFF_ROLES } from './decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard. Deny-by-default: every route requires a session unless marked @Public().
 * Also enforces:
 *  - CSRF: state-changing requests must carry the custom `x-kdcn-csrf` header, which browsers
 *    cannot attach cross-origin without a CORS preflight (which the API rejects).
 *  - Staff routes: role membership AND an MFA-verified session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<KdcnRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];

    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, targets);
    if (!skipCsrf && !SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException('Missing CSRF header');
    }

    const token = this.extractToken(req);
    if (token) {
      const auth = await this.sessions.resolve(token);
      if (auth) req.auth = auth;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    if (isPublic) return true;
    if (!req.auth) throw new UnauthorizedException('Sign in required');

    const staffRoles = this.reflector.getAllAndOverride<StaffRole[] | undefined>(STAFF_ROLES, targets);
    if (staffRoles) {
      const roles = req.auth.user.staffRoles;
      const allowed =
        roles.includes(StaffRole.SUPER_ADMIN) || staffRoles.length === 0 || staffRoles.some((r) => roles.includes(r));
      if (roles.length === 0 || !allowed) throw new ForbiddenException('Insufficient staff permissions');
      const allowUnverified = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_MFA, targets);
      if (!allowUnverified && !req.auth.mfaVerified) {
        throw new ForbiddenException({ message: 'Multi-factor authentication required', code: 'MFA_REQUIRED' });
      }
    }
    return true;
  }

  private extractToken(req: KdcnRequest): string | undefined {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (cookie) return cookie;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}
