import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AffiliationStatus, ListingStatus, OperatorRole } from '@prisma/client';
import { z } from 'zod';
import { Auth } from '../../common/auth/decorators';
import { AccessService } from '../../common/auth/access.service';
import { AuthContext, KdcnRequest } from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { parse, zId, zText } from '../../common/validation';
import { mediaUrl } from '../merchants/merchant-public';
import { StorageService } from '../storage/storage.service';
import { periodSchema, resolvePeriod } from '../analytics/analytics.controller';

/**
 * Market operator portal (e.g. Galaxy Mall management). Operators see only their market and
 * its affiliated merchants' public information and aggregate metrics. They never see customer
 * identities, merchant payout details, private addresses or individual merchant financials.
 */
@Controller('operator/:marketId')
export class OperatorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async overview(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string, @Query() query: unknown) {
    const member = await this.access.requireOperator(auth, marketId);
    const { from, to } = resolvePeriod(parse(periodSchema, query));
    const m = member.market;
    const affiliated = { affiliations: { some: { marketId, status: AffiliationStatus.APPROVED } } };
    const [merchantCount, pending, activeListings, agg, distinctMerchants] = await Promise.all([
      this.prisma.merchant.count({ where: { ...affiliated, status: 'APPROVED' } }),
      this.prisma.marketAffiliation.count({ where: { marketId, status: AffiliationStatus.PENDING } }),
      this.prisma.listing.count({ where: { status: ListingStatus.ACTIVE, merchant: affiliated } }),
      // Aggregate only — no per-merchant or per-customer breakdown.
      this.prisma.order.aggregate({ where: { merchant: affiliated, paidAt: { gte: from, lt: to } }, _count: true, _sum: { subtotalMinor: true } }),
      this.prisma.order.findMany({ where: { merchant: affiliated, paidAt: { gte: from, lt: to } }, distinct: ['merchantId'], select: { merchantId: true } }),
    ]);
    return {
      market: { id: m.id, slug: m.slug, name: m.name, kind: m.kind, tagline: m.tagline, description: m.description, publicAddress: m.publicAddress, openingHours: m.openingHours, coverUrl: mediaUrl(m.coverKey), logoUrl: mediaUrl(m.logoKey) },
      role: member.role,
      metrics: {
        period: { from, to },
        approvedMerchants: merchantCount,
        pendingAffiliations: pending,
        activeListings,
        paidOrders: agg._count,
        gmvMinor: agg._sum.subtotalMinor ?? 0,
        transactingMerchants: distinctMerchants.length,
      },
    };
  }

  @Patch()
  async update(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string, @Body() body: unknown, @Req() req: KdcnRequest) {
    await this.access.requireOperator(auth, marketId);
    const input = parse(z.object({ tagline: zText(140).optional(), description: zText(4000).optional(), openingHours: zText(200).optional(), publicAddress: zText(200).optional() }), body);
    await this.prisma.market.update({ where: { id: marketId }, data: input });
    await this.audit.record({ actor: auth, action: 'market.updated', entityType: 'market', entityId: marketId, metadata: { fields: Object.keys(input) }, ip: req.ip });
    return { ok: true };
  }

  @Post('images/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async image(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string, @Param('kind') kind: string, @UploadedFile() file?: Express.Multer.File) {
    await this.access.requireOperator(auth, marketId);
    if (kind !== 'cover' && kind !== 'logo') throw new NotFoundException();
    if (!file) throw new BadRequestException('file is required');
    const stored = await this.storage.putImage('markets', file.buffer);
    await this.prisma.market.update({ where: { id: marketId }, data: kind === 'cover' ? { coverKey: stored.key } : { logoKey: stored.key } });
    return { url: mediaUrl(stored.key) };
  }

  /** Participating merchants: public profile fields only. */
  @Get('merchants')
  async merchants(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string) {
    await this.access.requireOperator(auth, marketId);
    const rows = await this.prisma.marketAffiliation.findMany({
      where: { marketId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        status: true,
        unitLabel: true,
        createdAt: true,
        decidedAt: true,
        decisionNote: true,
        merchant: { select: { id: true, slug: true, displayName: true, type: true, status: true, publicAreaLabel: true, _count: { select: { listings: { where: { status: 'ACTIVE' } } } } } },
      },
    });
    return rows.map((r) => ({ ...r, merchant: { ...r.merchant, activeListings: r.merchant._count.listings, _count: undefined } }));
  }

  @Post('affiliations/:affiliationId/:decision')
  @HttpCode(200)
  async decide(
    @Auth() auth: AuthContext,
    @Param('marketId', ParseUUIDPipe) marketId: string,
    @Param('affiliationId', ParseUUIDPipe) affiliationId: string,
    @Param('decision') decision: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    await this.access.requireOperator(auth, marketId, OperatorRole.MARKET_ADMIN);
    const { note } = parse(z.object({ note: zText(300).default('') }), body ?? {});
    const status = decision === 'approve' ? AffiliationStatus.APPROVED : decision === 'reject' ? AffiliationStatus.REJECTED : decision === 'end' ? AffiliationStatus.ENDED : null;
    if (!status) throw new NotFoundException();
    const from = status === AffiliationStatus.ENDED ? AffiliationStatus.APPROVED : AffiliationStatus.PENDING;
    const res = await this.prisma.marketAffiliation.updateMany({
      where: { id: affiliationId, marketId, status: from },
      data: { status, decidedById: auth.user.id, decidedAt: new Date(), decisionNote: note },
    });
    if (!res.count) throw new ConflictException('Affiliation is not in a state that allows this decision');
    const a = await this.prisma.marketAffiliation.findUniqueOrThrow({ where: { id: affiliationId } });
    await this.audit.record({ actor: auth, action: `affiliation.${decision}`, entityType: 'affiliation', entityId: affiliationId, merchantId: a.merchantId, metadata: { marketId, note, by: 'operator' }, ip: req.ip });
    return a;
  }

  @Get('announcements')
  async announcements(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string) {
    await this.access.requireOperator(auth, marketId);
    return this.prisma.marketAnnouncement.findMany({ where: { marketId }, orderBy: { createdAt: 'desc' } });
  }

  @Post('announcements')
  async createAnnouncement(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string, @Body() body: unknown) {
    await this.access.requireOperator(auth, marketId);
    const input = parse(z.object({ title: zText(120).min(3), body: zText(2000).min(3), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().nullable().optional(), published: z.boolean().default(true) }), body);
    return this.prisma.marketAnnouncement.create({ data: { ...input, marketId, createdById: auth.user.id } });
  }

  @Patch('announcements/:id')
  async updateAnnouncement(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    await this.access.requireOperator(auth, marketId);
    const input = parse(z.object({ title: zText(120).min(3).optional(), body: zText(2000).min(3).optional(), endsAt: z.coerce.date().nullable().optional(), published: z.boolean().optional() }), body);
    const res = await this.prisma.marketAnnouncement.updateMany({ where: { id, marketId }, data: input });
    if (!res.count) throw new NotFoundException();
    return this.prisma.marketAnnouncement.findUniqueOrThrow({ where: { id } });
  }

  @Delete('announcements/:id')
  @HttpCode(204)
  async deleteAnnouncement(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.requireOperator(auth, marketId);
    const res = await this.prisma.marketAnnouncement.deleteMany({ where: { id, marketId } });
    if (!res.count) throw new NotFoundException();
  }

  @Get('collection-points')
  async collectionPoints(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string) {
    await this.access.requireOperator(auth, marketId);
    return this.prisma.collectionPoint.findMany({ where: { marketId }, orderBy: { name: 'asc' } });
  }

  @Post('collection-points')
  async createCollectionPoint(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string, @Body() body: unknown, @Req() req: KdcnRequest) {
    const member = await this.access.requireOperator(auth, marketId, OperatorRole.MARKET_ADMIN);
    const input = parse(z.object({ name: zText(80).min(3), publicAddress: zText(200).min(5), openingHours: zText(200).default(''), instructions: zText(500).default(''), areaId: zId.optional() }), body);
    const areaId = input.areaId ?? member.market.areaId;
    if (!areaId) throw new BadRequestException('areaId is required');
    const cp = await this.prisma.collectionPoint.create({ data: { ...input, areaId, marketId } });
    await this.audit.record({ actor: auth, action: 'collection_point.created', entityType: 'collection_point', entityId: cp.id, metadata: { marketId }, ip: req.ip });
    return cp;
  }

  @Patch('collection-points/:id')
  async updateCollectionPoint(@Auth() auth: AuthContext, @Param('marketId', ParseUUIDPipe) marketId: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    await this.access.requireOperator(auth, marketId, OperatorRole.MARKET_ADMIN);
    const input = parse(z.object({ name: zText(80).min(3).optional(), publicAddress: zText(200).min(5).optional(), openingHours: zText(200).optional(), instructions: zText(500).optional(), active: z.boolean().optional() }), body);
    const res = await this.prisma.collectionPoint.updateMany({ where: { id, marketId }, data: input });
    if (!res.count) throw new NotFoundException();
    return this.prisma.collectionPoint.findUniqueOrThrow({ where: { id } });
  }
}
