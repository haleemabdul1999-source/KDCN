import { MerchantSegment, MerchantStatus, MerchantType, Prisma } from '@prisma/client';
import { FLAGSHIP_MARKET_SLUG } from '../../config/constants';

/**
 * The ONLY merchant fields that may be returned by public endpoints. Note what is absent:
 * private fulfilment addresses, payout details, contact email, CAC number, verification docs.
 */
export const PUBLIC_MERCHANT_SELECT = {
  id: true,
  slug: true,
  displayName: true,
  type: true,
  description: true,
  logoKey: true,
  coverKey: true,
  publicAreaLabel: true,
  whatsappNumber: true,
  instagramHandle: true,
  returnPolicy: true,
  cancellationPolicy: true,
  defaultLeadTimeDays: true,
  approvedAt: true,
  publicArea: { select: { id: true, name: true, city: { select: { name: true } } } },
  verifications: {
    where: { status: 'APPROVED' as const },
    orderBy: { decidedAt: 'desc' as const },
    take: 1,
    select: { pathway: true, decidedAt: true, expiresAt: true },
  },
  affiliations: {
    where: { status: 'APPROVED' as const },
    select: {
      unitLabel: true,
      market: { select: { id: true, slug: true, name: true, kind: true } },
    },
  },
  locations: {
    where: { kind: 'PUBLIC_STORE' as const },
    select: {
      id: true,
      label: true,
      publicAddress: true,
      unitLabel: true,
      area: { select: { name: true } },
    },
  },
} satisfies Prisma.MerchantSelect;

export type PublicMerchantRow = Prisma.MerchantGetPayload<{
  select: typeof PUBLIC_MERCHANT_SELECT;
}>;

/** Public merchant visibility rule. */
export const VISIBLE_MERCHANT_WHERE = {
  status: MerchantStatus.APPROVED,
} satisfies Prisma.MerchantWhereInput;

export function serializePublicMerchant(m: PublicMerchantRow) {
  const v = m.verifications[0];
  const verificationValid = !!v && (!v.expiresAt || v.expiresAt > new Date());
  return {
    id: m.id,
    slug: m.slug,
    displayName: m.displayName,
    type: m.type,
    description: m.description,
    logoUrl: mediaUrl(m.logoKey),
    coverUrl: mediaUrl(m.coverKey),
    area: m.publicArea ? { name: m.publicArea.name, city: m.publicArea.city.name } : null,
    publicAreaLabel: m.publicAreaLabel,
    whatsappNumber: m.whatsappNumber,
    instagramHandle: m.instagramHandle,
    returnPolicy: m.returnPolicy,
    cancellationPolicy: m.cancellationPolicy,
    defaultLeadTimeDays: m.defaultLeadTimeDays,
    memberSince: m.approvedAt,
    /**
     * Identity verification only. The UI must present this as "Identity verified by KDCN",
     * never as a guarantee of product quality.
     */
    verification: verificationValid
      ? {
          status: 'IDENTITY_VERIFIED' as const,
          pathway: v.pathway,
          verifiedAt: v.decidedAt,
          expiresAt: v.expiresAt,
        }
      : { status: 'NOT_VERIFIED' as const },
    markets: m.affiliations.map((a) => ({ ...a.market, unitLabel: a.unitLabel })),
    publicLocations: m.locations.map((l) => ({
      id: l.id,
      label: l.label,
      address: l.publicAddress,
      unitLabel: l.unitLabel,
      area: l.area.name,
    })),
  };
}

export function mediaUrl(key: string | null | undefined): string | null {
  return key ? `/api/media/${key}` : null;
}

/** Reporting segment for a merchant at a point in time. */
export function segmentFor(type: MerchantType, approvedMarketSlugs: string[]): MerchantSegment {
  if (approvedMarketSlugs.includes(FLAGSHIP_MARKET_SLUG)) return MerchantSegment.GALAXY_MALL;
  if (approvedMarketSlugs.length > 0) return MerchantSegment.OTHER_MARKET;
  if (type === MerchantType.HOME_VENDOR) return MerchantSegment.HOME_VENDOR;
  return MerchantSegment.INDEPENDENT;
}
