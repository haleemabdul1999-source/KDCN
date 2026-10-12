export interface Availability {
  code: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'CONFIRM_ON_ORDER' | 'MADE_TO_ORDER';
  label: string;
  purchasable: boolean;
}

export interface ListingCard {
  id: string;
  slug: string;
  title: string;
  category: { slug: string; name: string };
  imageUrl: string | null;
  imageAlt: string;
  priceFromMinor: number | null;
  hasMultiplePrices: boolean;
  compareAtMinor: number | null;
  stockMode: string;
  availability: Availability;
  merchant: { slug: string; displayName: string; type: string; areaLabel: string | null; identityVerified: boolean; markets: { slug: string; name: string }[] };
  fulfilment: { delivery: boolean; collection: boolean };
}

export interface PublicMerchant {
  id: string;
  slug: string;
  displayName: string;
  type: string;
  description: string;
  logoUrl: string | null;
  coverUrl: string | null;
  publicAreaLabel: string | null;
  whatsappNumber: string | null;
  instagramHandle: string | null;
  returnPolicy: string;
  cancellationPolicy: string;
  memberSince: string | null;
  verification: { status: 'IDENTITY_VERIFIED'; pathway: string; verifiedAt: string; expiresAt: string | null } | { status: 'NOT_VERIFIED' };
  markets: { id: string; slug: string; name: string; kind: string; unitLabel: string | null }[];
  publicLocations: { id: string; label: string; address: string | null; unitLabel: string | null; area: string }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  staffRoles: string[];
  mfaEnabled: boolean;
  mfaVerified: boolean;
  merchants: { id: string; slug: string; displayName: string; status: string; type: string; role: string }[];
  markets: { id: string; slug: string; name: string; role: string }[];
}
