import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MerchantRole, OperatorRole, StaffRole } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthContext } from './auth.types';

const MERCHANT_ROLE_RANK: Record<MerchantRole, number> = { STAFF: 1, MANAGER: 2, OWNER: 3 };

/**
 * Object-level authorisation helpers. Callers must still scope every query by the resolved
 * merchantId / marketId — these checks establish membership, the query scoping prevents IDOR.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Throws 404 (not 403) when the user is not a member, to avoid revealing merchant IDs. */
  async requireMerchant(auth: AuthContext, merchantId: string, minRole: MerchantRole = MerchantRole.STAFF) {
    const member = await this.prisma.merchantMember.findUnique({
      where: { merchantId_userId: { merchantId, userId: auth.user.id } },
      include: { merchant: true },
    });
    if (!member) throw new NotFoundException('Merchant not found');
    if (MERCHANT_ROLE_RANK[member.role] < MERCHANT_ROLE_RANK[minRole]) {
      throw new ForbiddenException(`Requires merchant role ${minRole}`);
    }
    return member;
  }

  async requireOperator(auth: AuthContext, marketId: string, role?: OperatorRole) {
    const member = await this.prisma.marketOperatorMember.findUnique({
      where: { marketId_userId: { marketId, userId: auth.user.id } },
      include: { market: true },
    });
    if (!member) throw new NotFoundException('Market not found');
    if (role === OperatorRole.MARKET_ADMIN && member.role !== OperatorRole.MARKET_ADMIN) {
      throw new ForbiddenException('Requires market administrator role');
    }
    return member;
  }

  isStaff(auth: AuthContext | undefined, ...roles: StaffRole[]): boolean {
    if (!auth || !auth.mfaVerified) return false;
    const r = auth.user.staffRoles;
    return r.includes(StaffRole.SUPER_ADMIN) || roles.some((x) => r.includes(x));
  }
}
