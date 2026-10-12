import { Injectable } from '@nestjs/common';
import { CommissionScope, MerchantType } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export interface CommissionTerms {
  rateBps: number;
  serviceFeeMinor: number;
  ruleId: string | null;
  scope: CommissionScope | 'FALLBACK';
}

/** Fallback if no DEFAULT rule is configured: 5% commission, no service fee. */
export const FALLBACK_TERMS: CommissionTerms = {
  rateBps: 500,
  serviceFeeMinor: 0,
  ruleId: null,
  scope: 'FALLBACK',
};

/** Resolution precedence: MERCHANT > MARKET (approved affiliation) > MERCHANT_TYPE > DEFAULT. */
@Injectable()
export class CommissionService {
  constructor(private readonly prisma: PrismaService) {}

  async termsFor(
    merchantId: string,
    type: MerchantType,
    approvedMarketIds: string[],
  ): Promise<CommissionTerms> {
    const rules = await this.prisma.commissionRule.findMany({
      where: {
        active: true,
        OR: [
          { scope: CommissionScope.MERCHANT, scopeValue: merchantId },
          { scope: CommissionScope.MARKET, scopeValue: { in: approvedMarketIds } },
          { scope: CommissionScope.MERCHANT_TYPE, scopeValue: type },
          { scope: CommissionScope.DEFAULT },
        ],
      },
    });
    for (const scope of [
      CommissionScope.MERCHANT,
      CommissionScope.MARKET,
      CommissionScope.MERCHANT_TYPE,
      CommissionScope.DEFAULT,
    ]) {
      const r = rules.filter((x) => x.scope === scope).sort((a, b) => a.rateBps - b.rateBps)[0];
      if (r) return { rateBps: r.rateBps, serviceFeeMinor: r.serviceFeeMinor, ruleId: r.id, scope };
    }
    return FALLBACK_TERMS;
  }
}
