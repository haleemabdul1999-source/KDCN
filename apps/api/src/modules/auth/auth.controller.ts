import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { cookieSecure, env } from '../../config/env';
import {
  decryptField,
  DUMMY_PASSWORD_HASH,
  encryptField,
  generateTotpSecret,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
  verifyTotp,
} from '../../common/crypto';
import { NotificationService } from '../notifications/notification.service';
import { AllowUnverifiedMfa, Auth, CurrentAuth, Public, Staff } from '../../common/auth/decorators';
import {
  AuthContext,
  GUEST_CART_COOKIE,
  KdcnRequest,
  SESSION_COOKIE,
} from '../../common/auth/auth.types';
import { SessionService } from '../../common/auth/session.service';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { parse, zPhone } from '../../common/validation';
import { CartService } from '../cart/cart.service';

const AUTH_LIMIT = () => ({ default: { limit: env().AUTH_RATE_LIMIT_PER_MINUTE, ttl: 60_000 } });

const passwordSchema = z
  .string()
  .min(10, 'at least 10 characters')
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'must contain letters and numbers');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: zPhone.optional(),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly carts: CartService,
    private readonly notifications: NotificationService,
  ) {}

  @Public()
  @Throttle(AUTH_LIMIT())
  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() req: KdcnRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(registerSchema, body);
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An account with this email already exists');
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        phone: input.phone,
        passwordHash: await hashPassword(input.password),
        customerProfile: { create: {} },
      },
    });
    await this.startSession(user.id, false, true, req, res);
    return { user: { id: user.id, email: user.email, name: user.name } };
  }

  @Public()
  @Throttle(AUTH_LIMIT())
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: KdcnRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(loginSchema, body);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await verifyPassword(input.password, DUMMY_PASSWORD_HASH); // equalise timing
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account temporarily locked after repeated failed sign-ins. Try again later.',
      );
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      if (failed >= MAX_FAILED) {
        await this.audit.record({
          action: 'auth.account_locked',
          entityType: 'user',
          entityId: user.id,
          ip: req.ip,
        });
      }
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is not active');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    const isStaff = user.staffRoles.length > 0;
    await this.startSession(user.id, isStaff, !isStaff, req, res);
    if (isStaff) {
      await this.audit.record({
        action: 'auth.staff_login_password_ok',
        entityType: 'user',
        entityId: user.id,
        ip: req.ip,
      });
    }
    return {
      user: { id: user.id, email: user.email, name: user.name },
      mfaRequired: isStaff && user.mfaEnabled,
      mfaEnrolmentRequired: isStaff && !user.mfaEnabled,
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Public()
  @Get('me')
  async me(@CurrentAuth() auth?: AuthContext) {
    if (!auth) return { user: null };
    const [merchants, markets] = await Promise.all([
      this.prisma.merchantMember.findMany({
        where: { userId: auth.user.id },
        select: {
          role: true,
          merchant: {
            select: { id: true, slug: true, displayName: true, status: true, type: true },
          },
        },
      }),
      this.prisma.marketOperatorMember.findMany({
        where: { userId: auth.user.id },
        select: { role: true, market: { select: { id: true, slug: true, name: true } } },
      }),
    ]);
    return {
      user: {
        ...auth.user,
        mfaVerified: auth.mfaVerified,
        merchants: merchants.map((m) => ({ ...m.merchant, role: m.role })),
        markets: markets.map((m) => ({ ...m.market, role: m.role })),
      },
    };
  }

  /** Begin MFA enrolment: returns a new TOTP secret (shown once) and otpauth URI. */
  @Staff()
  @AllowUnverifiedMfa()
  @Post('mfa/setup')
  async mfaSetup(@Auth() auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (user.mfaEnabled && !auth.mfaVerified) {
      throw new ForbiddenException('MFA already enrolled; verify with your authenticator first');
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: encryptField(secret), mfaEnabled: false },
    });
    const label = encodeURIComponent(`KDCN:${user.email}`);
    return {
      secret,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=KDCN&digits=6&period=30`,
    };
  }

  /** Verify a TOTP code: completes enrolment and/or marks the current session MFA-verified. */
  @Staff()
  @AllowUnverifiedMfa()
  @Throttle(AUTH_LIMIT())
  @Post('mfa/verify')
  @HttpCode(200)
  async mfaVerify(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: KdcnRequest) {
    const { code } = parse(z.object({ code: z.string().trim() }), body);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    const secret = decryptField(user.mfaSecretEnc);
    if (!secret) throw new BadRequestException('MFA is not set up');
    if (!verifyTotp(secret, code)) {
      await this.audit.record({
        actor: auth,
        action: 'auth.mfa_failed',
        entityType: 'user',
        entityId: user.id,
        ip: req.ip,
      });
      throw new UnauthorizedException('Invalid verification code');
    }
    if (!user.mfaEnabled)
      await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await this.sessions.markMfaVerified(auth.sessionId);
    await this.audit.record({
      actor: auth,
      action: 'auth.mfa_verified',
      entityType: 'user',
      entityId: user.id,
      ip: req.ip,
    });
    return { ok: true };
  }

  @Throttle(AUTH_LIMIT())
  @Post('password')
  @HttpCode(204)
  async changePassword(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(
      z.object({ currentPassword: z.string(), newPassword: passwordSchema }),
      body,
    );
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.newPassword) },
    });
    // Revoke other sessions.
    await this.prisma.session.updateMany({
      where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actor: auth,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: user.id,
      ip: req.ip,
    });
  }

  /** Always 204, whether or not the email exists (no account enumeration). */
  @Public()
  @Throttle(AUTH_LIMIT())
  @Post('password-reset/request')
  @HttpCode(204)
  async requestReset(@Body() body: unknown, @Req() req: KdcnRequest) {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), body);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
    const token = randomToken(32);
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    await this.notifications.enqueue({
      userId: user.id,
      email: user.email,
      template: 'auth.password_reset',
      subject: 'Reset your KDCN password',
      body: `Use this link within 30 minutes to choose a new password: ${env().WEB_BASE_URL}/reset-password/${token} . If you didn't ask for this, ignore this email.`,
      channels: ['EMAIL'],
    });
    await this.audit.record({
      action: 'auth.password_reset_requested',
      entityType: 'user',
      entityId: user.id,
      ip: req.ip,
    });
  }

  @Public()
  @Throttle(AUTH_LIMIT())
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmReset(@Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(
      z.object({ token: z.string().min(20).max(100), newPassword: passwordSchema }),
      body,
    );
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (!row || row.usedAt || row.expiresAt < new Date())
      throw new BadRequestException('This reset link is invalid or has expired');
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new BadRequestException('This reset link has already been used');
      await tx.user.update({
        where: { id: row.userId },
        data: {
          passwordHash: await hashPassword(input.newPassword),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.session.updateMany({
        where: { userId: row.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'auth.password_reset_completed',
          entityType: 'user',
          entityId: row.userId,
          ip: req.ip,
        },
        tx,
      );
    });
  }

  /**
   * Account deletion (data-subject request). Personal data is erased/anonymised; order records
   * are retained with their snapshots for financial and legal record-keeping, unlinked from a
   * person's identity where possible. See docs/SECURITY.md (Data retention).
   */
  @Throttle(AUTH_LIMIT())
  @Post('account/delete')
  @HttpCode(204)
  async deleteAccount(
    @Auth() auth: AuthContext,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { password } = parse(z.object({ password: z.string().min(1) }), body);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (!(await verifyPassword(password, user.passwordHash)))
      throw new UnauthorizedException('Password is incorrect');
    if (user.staffRoles.length)
      throw new ForbiddenException('Staff accounts are closed by a super-admin');
    const owned = await this.prisma.merchantMember.count({
      where: { userId: user.id, role: 'OWNER' },
    });
    if (owned)
      throw new ConflictException('Close or transfer your store before deleting your account');
    const open = await this.prisma.order.count({
      where: { customerId: user.id, status: { notIn: ['COMPLETED', 'CANCELLED', 'REFUNDED'] } },
    });
    if (open)
      throw new ConflictException(
        'You have orders in progress. You can delete your account once they are completed.',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.deleteMany({ where: { userId: user.id } });
      await tx.cart.deleteMany({ where: { userId: user.id } });
      await tx.merchantMember.deleteMany({ where: { userId: user.id } });
      await tx.marketOperatorMember.deleteMany({ where: { userId: user.id } });
      await tx.notification.deleteMany({ where: { userId: user.id } });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.enquiry.deleteMany({ where: { customerId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: `deleted+${user.id}@invalid.kdcn`,
          name: 'Deleted user',
          phone: null,
          passwordHash: `deleted$${randomToken(16)}`,
          mfaSecretEnc: null,
          mfaEnabled: false,
          status: 'DELETED',
        },
      });
      // Order fulfilment snapshots held the contact phone and delivery address: erase them.
      await tx.fulfilment.updateMany({
        where: { order: { customerId: user.id } },
        data: { deliveryAddressEnc: null, recipientPhone: null },
      });
      await this.audit.record(
        { action: 'auth.account_deleted', entityType: 'user', entityId: user.id, ip: req.ip },
        tx,
      );
    });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  private async startSession(
    userId: string,
    isStaff: boolean,
    mfaVerified: boolean,
    req: KdcnRequest,
    res: Response,
  ) {
    const { token, session } = await this.sessions.create(userId, {
      isStaff,
      mfaVerified,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
    const guestToken = (req.cookies as Record<string, string> | undefined)?.[GUEST_CART_COOKIE];
    if (guestToken) {
      await this.carts.mergeGuestCart(guestToken, userId);
      res.clearCookie(GUEST_CART_COOKIE, { path: '/' });
    }
  }
}
