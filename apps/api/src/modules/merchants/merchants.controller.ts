import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  FulfilmentMethod,
  LocationKind,
  MerchantRole,
  MerchantStatus,
  MerchantType,
  SettlementMode,
  VerificationDocType,
  VerificationStatus,
} from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env';
import { Auth } from '../../common/auth/decorators';
import { AccessService } from '../../common/auth/access.service';
import { AuthContext, KdcnRequest } from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit.service';
import { decryptField, encryptField, randomToken, sha256 } from '../../common/crypto';
import { PrismaService } from '../../common/prisma.service';
import { parse, slugify, zId, zMinor, zPhone, zText } from '../../common/validation';
import { NotificationService } from '../notifications/notification.service';
import { DOCUMENT_TYPES } from '../storage/file-inspection';
import { StorageService } from '../storage/storage.service';
import { mediaUrl } from './merchant-public';
import { MerchantVerificationService } from './merchant-verification.service';

const createSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  type: z.nativeEnum(MerchantType),
  description: zText(2000).default(''),
  contactEmail: z.string().trim().toLowerCase().email(),
  contactPhone: zPhone,
  publicAreaId: zId,
  publicAreaLabel: zText(80).optional(),
  legalName: zText(120).optional(),
  cacNumber: z
    .string()
    .trim()
    .regex(/^(RC|BN|IT)?\s?\d{4,8}$/i, 'enter a valid CAC number')
    .optional(),
});

const updateSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  description: zText(2000).optional(),
  contactEmail: z.string().trim().toLowerCase().email().optional(),
  contactPhone: zPhone.optional(),
  publicAreaId: zId.optional(),
  publicAreaLabel: zText(80).nullable().optional(),
  whatsappNumber: zPhone.nullable().optional(),
  instagramHandle: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9._]{1,30}$/)
    .nullable()
    .optional(),
  legalName: zText(120).nullable().optional(),
  cacNumber: z
    .string()
    .trim()
    .regex(/^(RC|BN|IT)?\s?\d{4,8}$/i)
    .nullable()
    .optional(),
  returnPolicy: zText(2000).optional(),
  cancellationPolicy: zText(2000).optional(),
  defaultLeadTimeDays: z.number().int().min(0).max(90).optional(),
});

const payoutSchema = z.object({
  bankCode: z
    .string()
    .trim()
    .regex(/^\d{3,6}$/),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'NUBAN account numbers have 10 digits'),
  accountName: z.string().trim().min(2).max(120),
});

const locationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(LocationKind.PUBLIC_STORE),
    label: zText(80).min(2),
    areaId: zId,
    publicAddress: zText(200).min(5),
    marketId: zId.optional(),
    unitLabel: zText(40).optional(),
  }),
  z.object({
    kind: z.literal(LocationKind.PRIVATE_FULFILMENT),
    label: zText(80).min(2),
    areaId: zId,
    privateAddress: zText(300).min(5),
  }),
]);

const serviceAreasSchema = z.object({
  areas: z
    .array(
      z.object({ areaId: zId, deliveryFeeMinor: zMinor, etaDays: z.number().int().min(0).max(30) }),
    )
    .max(100),
});

const fulfilmentOptionsSchema = z.object({
  options: z
    .array(
      z.object({
        method: z.nativeEnum(FulfilmentMethod),
        enabled: z.boolean(),
        collectionPointId: zId.nullable().optional(),
        feeMinor: zMinor.default(0),
        instructions: zText(500).default(''),
        pickupFromMerchant: z.boolean().default(false),
      }),
    )
    .max(20),
});

@Controller()
export class MerchantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly verification: MerchantVerificationService,
  ) {}

  /** Start merchant registration. The caller becomes the OWNER. */
  @Post('merchants')
  async create(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(createSchema, body);
    const owned = await this.prisma.merchantMember.count({
      where: { userId: auth.user.id, role: MerchantRole.OWNER },
    });
    if (owned >= 5)
      throw new BadRequestException('Account already owns the maximum number of merchant profiles');
    const area = await this.prisma.area.findUnique({
      where: { id: input.publicAreaId },
      include: { city: true },
    });
    if (!area) throw new BadRequestException('Unknown area');

    const merchant = await this.prisma.$transaction(async (tx) => {
      const base = slugify(input.displayName) || 'shop';
      let slug = base;
      for (let i = 2; await tx.merchant.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
      const m = await tx.merchant.create({
        data: {
          slug,
          displayName: input.displayName,
          type: input.type,
          description: input.description,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          publicAreaId: area.id,
          // Home vendors default to a general-area label, never a street address.
          publicAreaLabel: input.publicAreaLabel ?? `${area.name}, ${area.city.name}`,
          legalName: input.legalName,
          cacNumber: input.cacNumber,
          status: MerchantStatus.DRAFT,
          members: { create: { userId: auth.user.id, role: MerchantRole.OWNER } },
        },
      });
      await this.audit.record(
        {
          actor: auth,
          action: 'merchant.created',
          entityType: 'merchant',
          entityId: m.id,
          merchantId: m.id,
          ip: req.ip,
        },
        tx,
      );
      return m;
    });
    return this.privateProfile(merchant.id);
  }

  @Get('merchant/:merchantId')
  async get(@Auth() auth: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string) {
    const member = await this.access.requireMerchant(auth, merchantId);
    return { ...(await this.privateProfile(merchantId)), myRole: member.role };
  }

  @Patch('merchant/:merchantId')
  async update(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const input = parse(updateSchema, body);
    if (
      input.publicAreaId &&
      !(await this.prisma.area.findUnique({ where: { id: input.publicAreaId } }))
    ) {
      throw new BadRequestException('Unknown area');
    }
    await this.prisma.merchant.update({ where: { id: merchantId }, data: input });
    await this.audit.record({
      actor: auth,
      action: 'merchant.profile_updated',
      entityType: 'merchant',
      entityId: merchantId,
      merchantId,
      metadata: { fields: Object.keys(input) },
      ip: req.ip,
    });
    return this.privateProfile(merchantId);
  }

  /** Payout details: OWNER only, encrypted at rest, audited. */
  @Put('merchant/:merchantId/payout')
  async setPayout(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.OWNER);
    const input = parse(payoutSchema, body);
    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: {
        payoutBankCode: input.bankCode,
        payoutAccountNumberEnc: encryptField(input.accountNumber),
        payoutAccountName: input.accountName,
        // Changing payout details invalidates any provider subaccount until re-provisioned by finance.
        providerSubaccountCode: null,
        settlementMode: SettlementMode.MANUAL_RECORD,
      },
    });
    await this.audit.record({
      actor: auth,
      action: 'merchant.payout_details_changed',
      entityType: 'merchant',
      entityId: merchantId,
      merchantId,
      metadata: { bankCode: input.bankCode, last4: input.accountNumber.slice(-4) },
      ip: req.ip,
    });
    return this.privateProfile(merchantId);
  }

  @Post('merchant/:merchantId/images/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadBrandImage(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    if (kind !== 'logo' && kind !== 'cover') throw new NotFoundException();
    if (!file) throw new BadRequestException('file is required');
    const stored = await this.storage.putImage('merchants', file.buffer);
    await this.prisma.merchant.update({
      where: { id: merchantId },
      data: kind === 'logo' ? { logoKey: stored.key } : { coverKey: stored.key },
    });
    return { url: mediaUrl(stored.key) };
  }

  // ── Locations ──────────────────────────────────────────────────────────

  @Post('merchant/:merchantId/locations')
  async addLocation(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const input = parse(locationSchema, body);
    if (!(await this.prisma.area.findUnique({ where: { id: input.areaId } })))
      throw new BadRequestException('Unknown area');
    if (input.kind === LocationKind.PUBLIC_STORE) {
      if (
        input.marketId &&
        !(await this.prisma.market.findUnique({ where: { id: input.marketId } }))
      ) {
        throw new BadRequestException('Unknown market');
      }
      await this.prisma.merchantLocation.create({
        data: {
          merchantId,
          kind: input.kind,
          label: input.label,
          areaId: input.areaId,
          publicAddress: input.publicAddress,
          marketId: input.marketId,
          unitLabel: input.unitLabel,
        },
      });
    } else {
      await this.prisma.merchantLocation.create({
        data: {
          merchantId,
          kind: input.kind,
          label: input.label,
          areaId: input.areaId,
          privateAddressEnc: encryptField(input.privateAddress),
        },
      });
    }
    await this.audit.record({
      actor: auth,
      action: 'merchant.location_added',
      entityType: 'merchant',
      entityId: merchantId,
      merchantId,
      metadata: { kind: input.kind },
      ip: req.ip,
    });
    return this.privateProfile(merchantId);
  }

  @Delete('merchant/:merchantId/locations/:locationId')
  async removeLocation(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const res = await this.prisma.merchantLocation.deleteMany({
      where: { id: locationId, merchantId },
    });
    if (res.count === 0) throw new NotFoundException('Location not found');
    return this.privateProfile(merchantId);
  }

  @Put('merchant/:merchantId/service-areas')
  async setServiceAreas(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: unknown,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const { areas } = parse(serviceAreasSchema, body);
    const ids = [...new Set(areas.map((a) => a.areaId))];
    if (ids.length !== areas.length) throw new BadRequestException('Duplicate area');
    if ((await this.prisma.area.count({ where: { id: { in: ids } } })) !== ids.length)
      throw new BadRequestException('Unknown area');
    await this.prisma.$transaction([
      this.prisma.merchantServiceArea.deleteMany({ where: { merchantId } }),
      this.prisma.merchantServiceArea.createMany({
        data: areas.map((a) => ({ ...a, merchantId })),
      }),
    ]);
    return this.privateProfile(merchantId);
  }

  @Put('merchant/:merchantId/fulfilment-options')
  async setFulfilmentOptions(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: unknown,
  ) {
    const member = await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const { options } = parse(fulfilmentOptionsSchema, body);
    const merchant = member.merchant;
    const approvedMarketIds = (
      await this.prisma.marketAffiliation.findMany({
        where: { merchantId, status: 'APPROVED' },
        select: { marketId: true },
      })
    ).map((a) => a.marketId);
    for (const o of options) {
      if (o.method === FulfilmentMethod.IN_STORE_COLLECTION && o.enabled) {
        const hasStore = await this.prisma.merchantLocation.count({
          where: { merchantId, kind: LocationKind.PUBLIC_STORE },
        });
        if (!hasStore)
          throw new BadRequestException('In-store collection requires a public store location');
        if (merchant.type === MerchantType.HOME_VENDOR) {
          throw new BadRequestException(
            'Home vendors cannot offer collection from their premises; use a collection point or delivery',
          );
        }
      }
      if (o.method === FulfilmentMethod.COLLECTION_POINT) {
        if (!o.collectionPointId)
          throw new BadRequestException('collectionPointId is required for collection points');
        const cp = await this.prisma.collectionPoint.findUnique({
          where: { id: o.collectionPointId },
        });
        if (!cp || !cp.active) throw new BadRequestException('Unknown collection point');
        // Market-operated shared collection points are restricted to affiliated merchants.
        if (cp.marketId && !approvedMarketIds.includes(cp.marketId)) {
          throw new ForbiddenException(
            'This collection point is only available to approved merchants of its market',
          );
        }
      } else {
        o.collectionPointId = null;
      }
      if (o.method === FulfilmentMethod.MERCHANT_DELIVERY && o.enabled) {
        const areas = await this.prisma.merchantServiceArea.count({ where: { merchantId } });
        if (!areas)
          throw new BadRequestException(
            'Merchant delivery requires at least one delivery service area',
          );
      }
    }
    await this.prisma.$transaction([
      this.prisma.merchantFulfilmentOption.deleteMany({ where: { merchantId } }),
      this.prisma.merchantFulfilmentOption.createMany({
        data: options.map((o) => ({
          ...o,
          collectionPointId: o.collectionPointId ?? null,
          merchantId,
        })),
      }),
    ]);
    return this.privateProfile(merchantId);
  }

  // ── Market affiliations ────────────────────────────────────────────────

  @Post('merchant/:merchantId/affiliations')
  async requestAffiliation(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const input = parse(z.object({ marketId: zId, unitLabel: zText(40).optional() }), body);
    const market = await this.prisma.market.findUnique({ where: { id: input.marketId } });
    if (!market || !market.active) throw new BadRequestException('Unknown market');
    const existing = await this.prisma.marketAffiliation.findUnique({
      where: { merchantId_marketId: { merchantId, marketId: market.id } },
    });
    if (existing && (existing.status === 'PENDING' || existing.status === 'APPROVED')) {
      throw new ConflictException('An affiliation request already exists for this market');
    }
    await this.prisma.marketAffiliation.upsert({
      where: { merchantId_marketId: { merchantId, marketId: market.id } },
      create: { merchantId, marketId: market.id, unitLabel: input.unitLabel },
      update: {
        status: 'PENDING',
        unitLabel: input.unitLabel,
        decidedAt: null,
        decidedById: null,
        decisionNote: null,
      },
    });
    await this.audit.record({
      actor: auth,
      action: 'affiliation.requested',
      entityType: 'merchant',
      entityId: merchantId,
      merchantId,
      metadata: { marketId: market.id },
      ip: req.ip,
    });
    return this.privateProfile(merchantId);
  }

  // ── Verification ───────────────────────────────────────────────────────

  @Post('merchant/:merchantId/verification/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadDocument(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: KdcnRequest,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.OWNER);
    const { type } = parse(z.object({ type: z.nativeEnum(VerificationDocType) }), body);
    if (!file) throw new BadRequestException('file is required');
    const verification = await this.verification.openVerification(merchantId);
    const count = await this.prisma.verificationDocument.count({
      where: { verificationId: verification.id },
    });
    if (count >= 15) throw new BadRequestException('Too many documents on this application');
    const stored = await this.storage.putPrivate('verification', file.buffer, DOCUMENT_TYPES);
    const doc = await this.prisma.verificationDocument.create({
      data: {
        verificationId: verification.id,
        type,
        storageKey: stored.key,
        originalName: (file.originalname || 'document').replace(/[^\w.\- ]/g, '_').slice(0, 100),
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        uploadedById: auth.user.id,
      },
    });
    await this.audit.record({
      actor: auth,
      action: 'verification.document_uploaded',
      entityType: 'merchant',
      entityId: merchantId,
      merchantId,
      metadata: { documentId: doc.id, type },
      ip: req.ip,
    });
    return { id: doc.id, type: doc.type, originalName: doc.originalName, createdAt: doc.createdAt };
  }

  @Delete('merchant/:merchantId/verification/documents/:documentId')
  @HttpCode(204)
  async deleteDocument(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.OWNER);
    const m = await this.prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    if (m.status === MerchantStatus.PENDING_REVIEW)
      throw new BadRequestException('Cannot remove documents while under review');
    const res = await this.prisma.verificationDocument.deleteMany({
      where: {
        id: documentId,
        verification: {
          merchantId,
          status: { in: [VerificationStatus.PENDING, VerificationStatus.INFO_REQUESTED] },
        },
      },
    });
    if (!res.count) throw new NotFoundException('Document not found');
  }

  /** Readiness checklist shown in onboarding. */
  @Get('merchant/:merchantId/verification')
  async verificationStatus(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    return this.verification.readiness(merchantId);
  }

  @Post('merchant/:merchantId/verification/submit')
  @HttpCode(200)
  async submit(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Req() req: KdcnRequest,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.OWNER);
    await this.verification.submit(merchantId, auth, req.ip);
    return this.verification.readiness(merchantId);
  }

  // ── Staff ──────────────────────────────────────────────────────────────

  @Get('merchant/:merchantId/members')
  async members(@Auth() auth: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.MANAGER);
    const [members, invitations] = await Promise.all([
      this.prisma.merchantMember.findMany({
        where: { merchantId },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.merchantInvitation.findMany({
        where: { merchantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true, expiresAt: true },
      }),
    ]);
    return { members, invitations };
  }

  @Post('merchant/:merchantId/invitations')
  async invite(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const member = await this.access.requireMerchant(auth, merchantId, MerchantRole.OWNER);
    const input = parse(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        role: z.enum([MerchantRole.MANAGER, MerchantRole.STAFF]),
      }),
      body,
    );
    const token = randomToken(24);
    const inv = await this.prisma.merchantInvitation.create({
      data: {
        merchantId,
        email: input.email,
        role: input.role,
        tokenHash: sha256(token),
        invitedById: auth.user.id,
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      },
    });
    const inviteUrl = `${env().WEB_BASE_URL}/invitations/${token}`;
    await this.notifications.enqueue({
      email: input.email,
      template: 'merchant.invitation',
      subject: `You've been invited to help manage ${member.merchant.displayName} on KDCN`,
      body: `Accept the invitation: ${inviteUrl} (expires in 7 days).`,
    });
    await this.audit.record({
      actor: auth,
      action: 'merchant.staff_invited',
      entityType: 'merchant',
      entityId: merchantId,
      merchantId,
      metadata: { invitationId: inv.id, role: input.role },
      ip: req.ip,
    });
    // The owner may also share the link directly (e.g. WhatsApp).
    return { id: inv.id, inviteUrl, expiresAt: inv.expiresAt };
  }

  @Delete('merchant/:merchantId/members/:memberId')
  @HttpCode(204)
  async removeMember(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Req() req: KdcnRequest,
  ) {
    await this.access.requireMerchant(auth, merchantId, MerchantRole.OWNER);
    const target = await this.prisma.merchantMember.findFirst({
      where: { id: memberId, merchantId },
    });
    if (!target) throw new NotFoundException();
    if (target.role === MerchantRole.OWNER)
      throw new BadRequestException('The owner cannot be removed');
    await this.prisma.merchantMember.delete({ where: { id: target.id } });
    await this.audit.record({
      actor: auth,
      action: 'merchant.staff_removed',
      entityType: 'merchant',
      entityId: merchantId,
      merchantId,
      metadata: { userId: target.userId },
      ip: req.ip,
    });
  }

  @Post('invitations/accept')
  @HttpCode(200)
  async acceptInvitation(
    @Auth() auth: AuthContext,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const { token } = parse(z.object({ token: z.string().min(10).max(100) }), body);
    const inv = await this.prisma.merchantInvitation.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date())
      throw new NotFoundException('Invitation not found or expired');
    if (inv.email !== auth.user.email)
      throw new ForbiddenException('This invitation was issued to a different email address');
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.merchantInvitation.updateMany({
        where: { id: inv.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ConflictException('Invitation already used');
      await tx.merchantMember.upsert({
        where: { merchantId_userId: { merchantId: inv.merchantId, userId: auth.user.id } },
        create: { merchantId: inv.merchantId, userId: auth.user.id, role: inv.role },
        update: {},
      });
      await this.audit.record(
        {
          actor: auth,
          action: 'merchant.staff_joined',
          entityType: 'merchant',
          entityId: inv.merchantId,
          merchantId: inv.merchantId,
          ip: req.ip,
        },
        tx,
      );
    });
    return { merchantId: inv.merchantId };
  }

  // ── Enquiries ──────────────────────────────────────────────────────────

  @Get('merchant/:merchantId/enquiries')
  async enquiries(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    return this.prisma.enquiry.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Post('merchant/:merchantId/enquiries/:enquiryId/reply')
  async replyEnquiry(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('enquiryId', ParseUUIDPipe) enquiryId: string,
    @Body() body: unknown,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    const { reply } = parse(z.object({ reply: zText(2000).min(1) }), body);
    const enquiry = await this.prisma.enquiry.findFirst({ where: { id: enquiryId, merchantId } });
    if (!enquiry) throw new NotFoundException();
    const updated = await this.prisma.enquiry.update({
      where: { id: enquiry.id },
      data: { reply, repliedAt: new Date() },
    });
    await this.notifications.enqueue({
      userId: enquiry.customerId,
      template: 'enquiry.replied',
      subject: 'A seller replied to your question',
      body: reply.slice(0, 300),
      data: { enquiryId },
      channels: [],
    });
    return updated;
  }

  // ── Internal ───────────────────────────────────────────────────────────

  async privateProfile(merchantId: string) {
    const m = await this.prisma.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      include: {
        publicArea: { include: { city: true } },
        locations: { include: { area: true, market: { select: { id: true, name: true } } } },
        serviceAreas: { include: { area: true } },
        fulfilmentOpts: { include: { collectionPoint: true } },
        affiliations: { include: { market: { select: { id: true, slug: true, name: true } } } },
        verifications: {
          orderBy: { submittedAt: 'desc' },
          take: 1,
          include: {
            documents: { select: { id: true, type: true, originalName: true, createdAt: true } },
          },
        },
      },
    });
    const acct = decryptField(m.payoutAccountNumberEnc);
    return {
      id: m.id,
      slug: m.slug,
      displayName: m.displayName,
      legalName: m.legalName,
      type: m.type,
      status: m.status,
      riskTier: m.riskTier,
      description: m.description,
      logoUrl: mediaUrl(m.logoKey),
      coverUrl: mediaUrl(m.coverKey),
      publicArea: m.publicArea
        ? { id: m.publicArea.id, name: m.publicArea.name, city: m.publicArea.city.name }
        : null,
      publicAreaLabel: m.publicAreaLabel,
      contactEmail: m.contactEmail,
      contactPhone: m.contactPhone,
      whatsappNumber: m.whatsappNumber,
      instagramHandle: m.instagramHandle,
      cacNumber: m.cacNumber,
      returnPolicy: m.returnPolicy,
      cancellationPolicy: m.cancellationPolicy,
      defaultLeadTimeDays: m.defaultLeadTimeDays,
      payout: acct
        ? {
            bankCode: m.payoutBankCode,
            accountNumberMasked: `******${acct.slice(-4)}`,
            accountName: m.payoutAccountName,
          }
        : null,
      settlementMode: m.settlementMode,
      suspensionReason: m.suspensionReason,
      locations: m.locations.map((l) => ({
        id: l.id,
        kind: l.kind,
        label: l.label,
        area: { id: l.area.id, name: l.area.name },
        publicAddress: l.publicAddress,
        // Visible to the merchant's own members only.
        privateAddress: decryptField(l.privateAddressEnc),
        market: l.market,
        unitLabel: l.unitLabel,
      })),
      serviceAreas: m.serviceAreas.map((s) => ({
        areaId: s.areaId,
        areaName: s.area.name,
        deliveryFeeMinor: s.deliveryFeeMinor,
        etaDays: s.etaDays,
      })),
      fulfilmentOptions: m.fulfilmentOpts.map((o) => ({
        method: o.method,
        enabled: o.enabled,
        collectionPointId: o.collectionPointId,
        collectionPointName: o.collectionPoint?.name ?? null,
        feeMinor: o.feeMinor,
        instructions: o.instructions,
        pickupFromMerchant: o.pickupFromMerchant,
      })),
      affiliations: m.affiliations.map((a) => ({
        id: a.id,
        status: a.status,
        unitLabel: a.unitLabel,
        market: a.market,
        decisionNote: a.decisionNote,
      })),
      verification: m.verifications[0]
        ? {
            id: m.verifications[0].id,
            pathway: m.verifications[0].pathway,
            status: m.verifications[0].status,
            requestNote: m.verifications[0].requestNote,
            decisionNotes: m.verifications[0].decisionNotes,
            expiresAt: m.verifications[0].expiresAt,
            documents: m.verifications[0].documents,
          }
        : null,
    };
  }
}
