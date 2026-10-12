import { Injectable } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { env } from '../../config/env';
import { randomToken, sha256 } from '../crypto';
import { PrismaService } from '../prisma.service';
import { AuthContext } from './auth.types';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, opts: { isStaff: boolean; mfaVerified: boolean; ip?: string; userAgent?: string }) {
    const token = randomToken(32);
    const ttlHours = opts.isStaff ? env().STAFF_SESSION_TTL_HOURS : env().SESSION_TTL_HOURS;
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        mfaVerified: opts.mfaVerified,
        ip: opts.ip,
        userAgent: opts.userAgent?.slice(0, 255),
        expiresAt,
      },
    });
    return { token, session };
  }

  async resolve(token: string): Promise<AuthContext | null> {
    if (token.length < 20 || token.length > 100) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    if (session.user.status !== UserStatus.ACTIVE) return null;
    // Touch lastSeenAt at most once a minute to avoid write amplification.
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    const u = session.user;
    return {
      sessionId: session.id,
      mfaVerified: session.mfaVerified,
      user: { id: u.id, email: u.email, name: u.name, staffRoles: u.staffRoles, mfaEnabled: u.mfaEnabled },
    };
  }

  async markMfaVerified(sessionId: string) {
    await this.prisma.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  }

  async revoke(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
