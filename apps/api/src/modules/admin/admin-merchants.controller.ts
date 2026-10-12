import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  AffiliationStatus,
  ListingStatus,
  MerchantStatus,
  MerchantType,
  ModerationStatus,
  Prisma,
  RiskTier,
  SettlementMode,
  StaffRole,
} from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, Staff } from '../../common/auth/decorators';
import { AuthContext, KdcnRequest } from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit.service';
import { decryptField } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { pageArgs, parse, zPage, zText } from '../../common/validation';
import { mediaUrl } from '../merchants/merchant-public';
import {
  DOC_LABEL,
  MerchantVerificationService,
  REQUIRED_DOCUMENTS,
} from '../merchants/merchant-verification.service';
import { mimeForKey, StorageService } from '../storage/storage.service';

@Controller('admin')
@Staff(StaffRole.OPERATIONS)
export class AdminMerchantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: MerchantVerificationService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  @Get('merchants')
  async list(@Query() query: unknown) {
    const q = parse(
      zPage.extend({
        status: z.nativeEnum(MerchantStatus).optional(),
        type: z.nativeEnum(MerchantType).optional(),
        q: z.string().max(100).optional(),
      }),
      query,
    );
    const where: Prisma.MerchantWhereInput = {
      status: q.status,
      type: q.type,
      ...(q.q
        ? {
            OR: [
              { displayName: { contains: q.q, mode: 'insensitive' } },
              { slug: { contains: q.q } },
              { contactEmail: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total, counts] = await Promise.all([
      this.prisma.merchant.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        ...pageArgs(q),
        select: {
          id: true,
          slug: true,
          displayName: true,
          type: true,
          status: true,
          riskTier: true,
          publicAreaLabel: true,
          createdAt: true,
          updatedAt: true,
          verifications: {
            orderBy: { submittedAt: 'desc' },
            take: 1,
            select: { pathway: true, status: true, submittedAt: true, expiresAt: true },
          },
        },
      }),
      this.prisma.merchant.count({ where }),
      this.prisma.merchant.groupBy({ by: ['status'], _count: true }),
    ]);
    return {
      items,
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  /** Full merchant record for review. Viewing private details is audited. */
  @Get('merchants/:id')
  async get(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: KdcnRequest,
  ) {
    const m = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        publicArea: true,
        members: {
          include: { user: { select: { id: true, name: true, email: true, phone: true } } },
        },
        locations: { include: { area: true, market: true } },
        serviceAreas: { include: { area: true } },
        fulfilmentOpts: { include: { collectionPoint: true } },
        affiliations: { include: { market: true } },
        verifications: { orderBy: { submittedAt: 'desc' }, include: { documents: true } },
        _count: { select: { listings: true, orders: true } },
      },
    });
    if (!m) throw new NotFoundException();
    await this.audit.record({
      actor: auth,
      action: 'admin.merchant_viewed',
      entityType: 'merchant',
      entityId: id,
      merchantId: id,
      ip: req.ip,
    });
    const acct = decryptField(m.payoutAccountNumberEnc);
    const current = m.verifications[0];
    return {
      ...m,
      payoutAccountNumberEnc: undefined,
      payout: acct
        ? {
            bankCode: m.payoutBankCode,
            accountNumberMasked: `******${acct.slice(-4)}`,
            accountName: m.payoutAccountName,
          }
        : null,
      logoUrl: mediaUrl(m.logoKey),
      coverUrl: mediaUrl(m.coverKey),
      locations: m.locations.map((l) => ({
        ...l,
        privateAddressEnc: undefined,
        privateAddress: decryptField(l.privateAddressEnc),
      })),
      requiredDocuments: current
        ? REQUIRED_DOCUMENTS[current.pathway].map((t) => ({
            type: t,
            label: DOC_LABEL[t],
            provided: current.documents.some((d) => d.type === t),
          }))
        : [],
    };
  }

  /** Stream a verification document (decrypted). Every access is audited. */
  @Get('verification-documents/:docId')
  async document(
    @Auth() auth: AuthContext,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: KdcnRequest,
    @Res() res: Response,
  ) {
    const doc = await this.prisma.verificationDocument.findUnique({
      where: { id: docId },
      include: { verification: true },
    });
    if (!doc) throw new NotFoundException();
    const buf = await this.storage.read('private', doc.storageKey);
    await this.audit.record({
      actor: auth,
      action: 'admin.verification_document_viewed',
      entityType: 'verification_document',
      entityId: docId,
      merchantId: doc.verification.merchantId,
      ip: req.ip,
    });
    res.setHeader('Content-Type', mimeForKey(doc.storageKey));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${doc.id}.${doc.storageKey.split('.').pop()}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  }

  @Post('merchants/:id/:decision')
  @HttpCode(200)
  async decide(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision') decision: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const input = parse(
      z.object({ note: zText(1000).default(''), riskTier: z.nativeEnum(RiskTier).optional() }),
      body ?? {},
    );
    switch (decision) {
      case 'approve':
        await this.verification.approve(id, auth, input.note, req.ip);
        break;
      case 'reject':
        if (input.note.length < 5) throw new ConflictException('A reason is required');
        await this.verification.reject(id, auth, input.note, req.ip);
        break;
      case 'request-info':
        if (input.note.length < 5) throw new ConflictException('Describe what is needed');
        await this.verification.requestInfo(id, auth, input.note, input.riskTier, req.ip);
        break;
      case 'suspend':
        if (input.note.length < 5) throw new ConflictException('A reason is required');
        await this.verification.suspend(id, auth, input.note, req.ip);
        break;
      case 'reinstate':
        await this.verification.reinstate(id, auth, input.note, req.ip);
        break;
      case 'risk-tier': {
        if (!input.riskTier) throw new ConflictException('riskTier is required');
        await this.prisma.merchant.update({ where: { id }, data: { riskTier: input.riskTier } });
        await this.audit.record({
          actor: auth,
          action: 'merchant.risk_tier_changed',
          entityType: 'merchant',
          entityId: id,
          merchantId: id,
          metadata: { riskTier: input.riskTier, note: input.note },
          ip: req.ip,
        });
        break;
      }
      default:
        throw new NotFoundException('Unknown decision');
    }
    return this.prisma.merchant.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true, riskTier: true },
    });
  }

  /** Finance: link a provider subaccount so the provider settles the merchant share directly. */
  @Staff(StaffRole.FINANCE)
  @Post('merchants/:id/settlement-mode')
  @HttpCode(200)
  async settlementMode(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const input = parse(
      z.object({
        mode: z.nativeEnum(SettlementMode),
        providerSubaccountCode: z.string().trim().max(60).nullable().optional(),
      }),
      body,
    );
    if (input.mode === SettlementMode.PROVIDER_SPLIT && !input.providerSubaccountCode)
      throw new ConflictException('A provider subaccount code is required for split settlement');
    await this.prisma.merchant.update({
      where: { id },
      data: {
        settlementMode: input.mode,
        providerSubaccountCode: input.providerSubaccountCode ?? null,
      },
    });
    await this.audit.record({
      actor: auth,
      action: 'merchant.settlement_mode_changed',
      entityType: 'merchant',
      entityId: id,
      merchantId: id,
      metadata: input,
      ip: req.ip,
    });
    return { ok: true };
  }

  // ── Product moderation ───────────────────────────────────────────────

  @Get('moderation/products')
  async moderationQueue(@Query() query: unknown) {
    const q = parse(
      zPage.extend({
        status: z.nativeEnum(ModerationStatus).default(ModerationStatus.PENDING_REVIEW),
      }),
      query,
    );
    const where = { moderationStatus: q.status };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        ...pageArgs(q),
        include: {
          category: true,
          images: { take: 3 },
          createdBy: { select: { id: true, displayName: true, type: true, riskTier: true } },
          listings: { select: { id: true, slug: true, status: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: items.map((p) => ({
        ...p,
        images: p.images.map((i) => ({ url: mediaUrl(i.storageKey) })),
      })),
      total,
    };
  }

  @Post('moderation/products/:id')
  @HttpCode(200)
  async moderateProduct(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const input = parse(
      z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: zText(500).default('') }),
      body,
    );
    const p = await this.prisma.product.update({
      where: { id },
      data: { moderationStatus: input.decision, moderationNote: input.note || null },
    });
    await this.audit.record({
      actor: auth,
      action: 'product.moderated',
      entityType: 'product',
      entityId: id,
      merchantId: p.createdByMerchantId,
      metadata: input,
      ip: req.ip,
    });
    return p;
  }

  @Post('listings/:id/:action')
  @HttpCode(200)
  async blockListing(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const { reason } = parse(z.object({ reason: zText(500).min(3) }), body);
    if (action !== 'block' && action !== 'unblock') throw new NotFoundException();
    const l = await this.prisma.listing.update({
      where: { id },
      data: { status: action === 'block' ? ListingStatus.BLOCKED : ListingStatus.PAUSED },
    });
    await this.audit.record({
      actor: auth,
      action: `listing.${action}ed`,
      entityType: 'listing',
      entityId: id,
      merchantId: l.merchantId,
      metadata: { reason },
      ip: req.ip,
    });
    return { id: l.id, status: l.status };
  }

  // ── Market affiliations (staff may also decide) ────────────────────────

  @Get('affiliations')
  async affiliations(@Query() query: unknown) {
    const q = parse(
      z.object({ status: z.nativeEnum(AffiliationStatus).default(AffiliationStatus.PENDING) }),
      query,
    );
    return this.prisma.marketAffiliation.findMany({
      where: { status: q.status },
      orderBy: { createdAt: 'asc' },
      include: {
        market: { select: { id: true, name: true } },
        merchant: { select: { id: true, displayName: true, type: true, status: true } },
      },
    });
  }

  @Post('affiliations/:id/:decision')
  @HttpCode(200)
  async decideAffiliation(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision') decision: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const { note } = parse(z.object({ note: zText(300).default('') }), body ?? {});
    const status =
      decision === 'approve'
        ? AffiliationStatus.APPROVED
        : decision === 'reject'
          ? AffiliationStatus.REJECTED
          : decision === 'end'
            ? AffiliationStatus.ENDED
            : null;
    if (!status) throw new NotFoundException();
    const res = await this.prisma.marketAffiliation.updateMany({
      where: {
        id,
        status:
          status === AffiliationStatus.ENDED
            ? AffiliationStatus.APPROVED
            : AffiliationStatus.PENDING,
      },
      data: { status, decidedById: auth.user.id, decidedAt: new Date(), decisionNote: note },
    });
    if (!res.count)
      throw new ConflictException('Affiliation is not in a state that allows this decision');
    const a = await this.prisma.marketAffiliation.findUniqueOrThrow({ where: { id } });
    await this.audit.record({
      actor: auth,
      action: `affiliation.${decision}`,
      entityType: 'affiliation',
      entityId: id,
      merchantId: a.merchantId,
      metadata: { note, by: 'staff' },
      ip: req.ip,
    });
    return a;
  }
}
