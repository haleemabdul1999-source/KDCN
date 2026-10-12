'use client';

import { createContext, useContext } from 'react';

export interface MerchantProfile {
  id: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  type: string;
  status: string;
  riskTier: string;
  description: string;
  logoUrl: string | null;
  coverUrl: string | null;
  publicArea: { id: string; name: string; city: string } | null;
  publicAreaLabel: string | null;
  contactEmail: string;
  contactPhone: string;
  whatsappNumber: string | null;
  instagramHandle: string | null;
  cacNumber: string | null;
  returnPolicy: string;
  cancellationPolicy: string;
  defaultLeadTimeDays: number;
  payout: { bankCode: string; accountNumberMasked: string; accountName: string } | null;
  settlementMode: string;
  suspensionReason: string | null;
  locations: { id: string; kind: string; label: string; area: { id: string; name: string }; publicAddress: string | null; privateAddress: string | null; market: { id: string; name: string } | null; unitLabel: string | null }[];
  serviceAreas: { areaId: string; areaName: string; deliveryFeeMinor: number; etaDays: number }[];
  fulfilmentOptions: { method: string; enabled: boolean; collectionPointId: string | null; collectionPointName: string | null; feeMinor: number; instructions: string; pickupFromMerchant: boolean }[];
  affiliations: { id: string; status: string; unitLabel: string | null; market: { id: string; slug: string; name: string }; decisionNote: string | null }[];
  verification: { id: string; pathway: string; status: string; requestNote: string | null; decisionNotes: string | null; expiresAt: string | null; documents: { id: string; type: string; originalName: string }[] } | null;
  myRole: string;
}

export const MerchantCtx = createContext<{ m: MerchantProfile; reload: () => Promise<void>; setM: (m: MerchantProfile) => void } | null>(null);

export function useMerchant() {
  const v = useContext(MerchantCtx);
  if (!v) throw new Error('useMerchant outside merchant layout');
  return v;
}
