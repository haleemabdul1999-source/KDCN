import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LocationKind,
  Merchant,
  MerchantStatus,
  MerchantType,
  RiskTier,
  VerificationDocType as D,
  VerificationPathway as P,
  VerificationStatus,
} from '@prisma/client';
import { VERIFICATION_VALIDITY_DAYS } from '../../config/constants';
import { AuditService } from '../../common/audit.service';
import { AuthContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../common/prisma.service';
import { NotificationService } from '../notifications/notification.service';

/**
 * Differentiated verification pathways. Identity verification establishes who the merchant is;
 * it is NOT a guarantee of product quality and the UI never presents it as one.
 */
export const REQUIRED_DOCUMENTS: Record<P, D[]> = {
  [P.HOME_VENDOR_SOLE_TRADER]: [D.GOVERNMENT_ID, D.SELFIE],
  [P.REGISTERED_BUSINESS]: [D.GOVERNMENT_ID, D.CAC_CERTIFICATE],
  [P.MARKET_RETAILER]: [D.GOVERNMENT_ID, D.TENANCY_OR_SHOP_ALLOCATION],
  [P.ENHANCED]: [D.GOVERNMENT_ID, D.SELFIE, D.PROOF_OF_ADDRESS],
};

export const DOC_LABEL: Record<D, string> = {
  GOVERNMENT_ID: 'Government-issued photo ID (NIN slip, driver’s licence, voter’s card or passport)',
  CAC_CERTIFICATE: 'CAC registration certificate',
  PROOF_OF_ADDRESS: 'Proof of address (utility bill or tenancy, not shown publicly)',
  TENANCY_OR_SHOP_ALLOCATION: 'Shop tenancy or market allocation letter',
  SELFIE: 'Selfie holding your ID',
  FOOD_HANDLING_PERMIT: 'Food handling permit / NAFDAC registration',
  OTHER: 'Other supporting document',
};

export function pathwayFor(m: Pick<Merchant, 'type' | 'riskTier' | 'cacNumber'>): P {
  if (m.riskTier === RiskTier.ENHANCED) return P.ENHANCED;
  if (m.type === MerchantType.MALL_RETAILER || m.type === MerchantType.MARKET_TRADER) return P.MARKET_RETAILER;
  if (m.type === MerchantType.INDEPENDENT_SHOP && m.cacNumber) return P.REGISTERED_BUSINESS;
  return P.HOME_VENDOR_SOLE_TRADER;
}

@Injectable()
export class MerchantVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** The verification record documents are attached to (created on first upload). */
  async openVerification(merchantId: string) {
    const merchant = await this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    const open = await this.prisma.merchantVerification.findFirst({
      where: { merchantId, status: { in: [VerificationStatus.PENDING, VerificationStatus.INFO_REQUESTED] } },
      orderBy: { submittedAt: 'desc' },
    });
    if (open) {
      const pathway = pathwayFor(merchant);
      if (open.pathway !== pathway) {
        return this.prisma.merchantVerification.update({ where: { id: open.id }, data: { pathway } });
      }
      return open;
    }
    return this.prisma.merchantVerification.create({ data: { merchantId, pathway: pathwayFor(merchant) } });
  }

  async readiness(merchantId: string) {
    const m = await this.prisma.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      include: {
        locations: true,
        fulfilmentOpts: { where: { enabled: true } },
        affiliations: { where: { status: { in: ['PENDING', 'APPROVED'] } } },
        verifications: { orderBy: { submittedAt: 'desc' }, take: 1, include: { documents: true } },
      },
    });
    const pathway = pathwayFor(m);
    const v = m.verifications[0];
    const uploaded = new Set(v?.documents.map((d) => d.type) ?? []);
    const checklist: { key: string; label: string; done: boolean }[] = [
      { key: 'profile', label: 'Business name, description and contact details', done: m.description.trim().length >= 20 },
      { key: 'payout', label: 'Payout bank account', done: !!m.payoutAccountNumberEnc },
      { key: 'fulfilment', label: 'At least one delivery or collection option', done: m.fulfilmentOpts.length > 0 },
    ];
    if (m.type === MerchantType.HOME_VENDOR) {
      checklist.push({
        key: 'private_location',
        label: 'Private fulfilment address (kept confidential, used only for logistics pickup)',
        done: m.locations.some((l) => l.kind === LocationKind.PRIVATE_FULFILMENT),
      });
    }
    if (m.type === MerchantType.MALL_RETAILER || m.type === MerchantType.MARKET_TRADER) {
      checklist.push({ key: 'affiliation', label: 'Request to join your mall or market', done: m.affiliations.length > 0 });
      checklist.push({ key: 'store_location', label: 'Shop location (unit / shop number)', done: m.locations.some((l) => l.kind === LocationKind.PUBLIC_STORE) });
    }
    for (const doc of REQUIRED_DOCUMENTS[pathway]) {
      checklist.push({ key: `doc_${doc}`, label: DOC_LABEL[doc], done: uploaded.has(doc) });
    }
    const submittable: MerchantStatus[] = [MerchantStatus.DRAFT, MerchantStatus.INFO_REQUESTED, MerchantStatus.REJECTED];
    return {
      merchantStatus: m.status,
      pathway,
      verification: v ? { id: v.id, status: v.status, requestNote: v.requestNote, decisionNotes: v.decisionNotes, expiresAt: v.expiresAt } : null,
      documents: v?.documents.map((d) => ({ id: d.id, type: d.type, originalName: d.originalName, createdAt: d.createdAt })) ?? [],
      checklist,
      canSubmit: submittable.includes(m.status) && checklist.every((c) => c.done),
    };
  }

  async submit(merchantId: string, actor: AuthContext, ip?: string) {
    const r = await this.readiness(merchantId);
    if (!r.canSubmit) {
      const missing = r.checklist.filter((c) => !c.done).map((c) => c.label);
      throw new BadRequestException({ message: 'Application is incomplete', missing });
    }
    const v = await this.openVerification(merchantId);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.merchant.updateMany({
        where: { id: merchantId, status: { in: [MerchantStatus.DRAFT, MerchantStatus.INFO_REQUESTED, MerchantStatus.REJECTED] } },
        data: { status: MerchantStatus.PENDING_REVIEW },
      });
      if (moved.count !== 1) throw new ConflictException('Application already submitted');
      await tx.merchantVerification.update({ where: { id: v.id }, data: { status: VerificationStatus.PENDING, submittedAt: new Date() } });
      await this.audit.record({ actor, action: 'verification.submitted', entityType: 'merchant', entityId: merchantId, merchantId, metadata: { verificationId: v.id, pathway: v.pathway }, ip }, tx);
    });
  }

  // ── Staff decisions ──────────────────────────────────────────────────

  private async pendingVerification(merchantId: string) {
    const v = await this.prisma.merchantVerification.findFirst({
      where: { merchantId, status: { in: [VerificationStatus.PENDING, VerificationStatus.INFO_REQUESTED] } },
      orderBy: { submittedAt: 'desc' },
    });
    if (!v) throw new NotFoundException('No open verification for this merchant');
    return v;
  }

  async approve(merchantId: string, actor: AuthContext, notes: string, ip?: string) {
    const v = await this.pendingVerification(merchantId);
    const m = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.merchant.updateMany({
        where: { id: merchantId, status: MerchantStatus.PENDING_REVIEW },
        data: { status: MerchantStatus.APPROVED, approvedAt: new Date() },
      });
      if (moved.count !== 1) throw new ConflictException('Merchant is not awaiting review');
      await tx.merchantVerification.update({
        where: { id: v.id },
        data: {
          status: VerificationStatus.APPROVED,
          reviewerId: actor.user.id,
          decisionNotes: notes,
          decidedAt: new Date(),
          expiresAt: new Date(Date.now() + VERIFICATION_VALIDITY_DAYS * 86400_000),
        },
      });
      await this.audit.record({ actor, action: 'merchant.approved', entityType: 'merchant', entityId: merchantId, merchantId, metadata: { verificationId: v.id, pathway: v.pathway, notes }, ip }, tx);
      return tx.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    });
    await this.notifyOwners(merchantId, 'merchant.approved', 'Your KDCN store is approved', `${m.displayName} is approved. Your active listings are now visible to customers.`);
  }

  async reject(merchantId: string, actor: AuthContext, notes: string, ip?: string) {
    const v = await this.pendingVerification(merchantId);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.merchant.updateMany({ where: { id: merchantId, status: MerchantStatus.PENDING_REVIEW }, data: { status: MerchantStatus.REJECTED } });
      if (moved.count !== 1) throw new ConflictException('Merchant is not awaiting review');
      await tx.merchantVerification.update({ where: { id: v.id }, data: { status: VerificationStatus.REJECTED, reviewerId: actor.user.id, decisionNotes: notes, decidedAt: new Date() } });
      await this.audit.record({ actor, action: 'merchant.rejected', entityType: 'merchant', entityId: merchantId, merchantId, metadata: { verificationId: v.id, notes }, ip }, tx);
    });
    await this.notifyOwners(merchantId, 'merchant.rejected', 'Update on your KDCN application', `Your application was not approved: ${notes}`);
  }

  async requestInfo(merchantId: string, actor: AuthContext, note: string, riskTier: RiskTier | undefined, ip?: string) {
    const v = await this.pendingVerification(merchantId);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.merchant.updateMany({
        where: { id: merchantId, status: MerchantStatus.PENDING_REVIEW },
        data: { status: MerchantStatus.INFO_REQUESTED, ...(riskTier ? { riskTier } : {}) },
      });
      if (moved.count !== 1) throw new ConflictException('Merchant is not awaiting review');
      await tx.merchantVerification.update({ where: { id: v.id }, data: { status: VerificationStatus.INFO_REQUESTED, requestNote: note, reviewerId: actor.user.id } });
      await this.audit.record({ actor, action: 'merchant.info_requested', entityType: 'merchant', entityId: merchantId, merchantId, metadata: { note, riskTier }, ip }, tx);
    });
    await this.notifyOwners(merchantId, 'merchant.info_requested', 'More information needed for your KDCN application', note);
  }

  async suspend(merchantId: string, actor: AuthContext, reason: string, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.merchant.updateMany({
        where: { id: merchantId, status: MerchantStatus.APPROVED },
        data: { status: MerchantStatus.SUSPENDED, suspendedAt: new Date(), suspensionReason: reason },
      });
      if (moved.count !== 1) throw new ConflictException('Only approved merchants can be suspended');
      await this.audit.record({ actor, action: 'merchant.suspended', entityType: 'merchant', entityId: merchantId, merchantId, metadata: { reason }, ip }, tx);
    });
    await this.notifyOwners(merchantId, 'merchant.suspended', 'Your KDCN store has been suspended', reason);
  }

  async reinstate(merchantId: string, actor: AuthContext, note: string, ip?: string) {
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.merchant.updateMany({
        where: { id: merchantId, status: MerchantStatus.SUSPENDED },
        data: { status: MerchantStatus.APPROVED, suspendedAt: null, suspensionReason: null },
      });
      if (moved.count !== 1) throw new ConflictException('Merchant is not suspended');
      await this.audit.record({ actor, action: 'merchant.reinstated', entityType: 'merchant', entityId: merchantId, merchantId, metadata: { note }, ip }, tx);
    });
  }

  /** Expire time-limited verifications (job). Expired merchants remain listed but lose the badge. */
  async expireVerifications(): Promise<number> {
    const res = await this.prisma.merchantVerification.updateMany({
      where: { status: VerificationStatus.APPROVED, expiresAt: { lt: new Date() } },
      data: { status: VerificationStatus.EXPIRED },
    });
    return res.count;
  }

  private async notifyOwners(merchantId: string, template: string, subject: string, body: string) {
    const owners = await this.prisma.merchantMember.findMany({ where: { merchantId, role: 'OWNER' }, include: { user: true } });
    for (const o of owners) {
      await this.notifications.enqueue({ userId: o.userId, email: o.user.email, template, subject, body, data: { merchantId } });
    }
  }
}
