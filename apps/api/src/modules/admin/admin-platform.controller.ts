import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { CommissionScope, MarketKind, OperatorRole, ReportStatus, ReviewStatus, StaffRole, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { Auth, Staff } from '../../common/auth/decorators';
import { AuthContext, KdcnRequest } from '../../common/auth/auth.types';
import { SessionService } from '../../common/auth/session.service';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { pageArgs, parse, zId, zMinor, zPage, zSlug, zText } from '../../common/validation';
import { periodSchema, resolvePeriod } from '../analytics/analytics.controller';
import { AnalyticsService } from '../analytics/analytics.service';
import { ReviewsService } from '../disputes/disputes.service';
import { JobsService } from '../jobs/jobs.service';

@Controller('admin')
export class AdminPlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly reviews: ReviewsService,
    private readonly jobs: JobsService,
  ) {}

  @Staff()
  @Get('overview')
  async overview() {
    const [pendingMerchants, pendingProducts, pendingAffiliations, openDisputes, refundsAwaiting, failedRefunds, openReports, awaitingDispatch, unprocessedWebhooks] = await Promise.all([
      this.prisma.merchant.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.product.count({ where: { moderationStatus: 'PENDING_REVIEW' } }),
      this.prisma.marketAffiliation.count({ where: { status: 'PENDING' } }),
      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'AWAITING_MERCHANT', 'UNDER_REVIEW'] } } }),
      this.prisma.refund.count({ where: { status: 'REQUESTED' } }),
      this.prisma.refund.count({ where: { status: 'FAILED' } }),
      this.prisma.abuseReport.count({ where: { status: 'OPEN' } }),
      this.prisma.fulfilment.count({ where: { method: 'THIRD_PARTY_DELIVERY', status: { in: ['PENDING', 'PREPARING', 'FAILED_ATTEMPT'] }, order: { paidAt: { not: null }, status: { notIn: ['CANCELLED', 'REFUNDED', 'REFUND_PENDING'] } } } }),
      this.prisma.providerWebhookEvent.count({ where: { processedAt: null } }),
    ]);
    return { queues: { pendingMerchants, pendingProducts, pendingAffiliations, openDisputes, refundsAwaiting, failedRefunds, openReports, awaitingDispatch, unprocessedWebhooks } };
  }

  @Staff()
  @Get('analytics')
  async metrics(@Query() query: unknown) {
    const { from, to } = resolvePeriod(parse(periodSchema, query));
    return this.analytics.platformMetrics(from, to);
  }

  // ── Commission ───────────────────────────────────────────────────────

  @Staff(StaffRole.FINANCE)
  @Get('commission-rules')
  async rules() {
    return this.prisma.commissionRule.findMany({ orderBy: [{ scope: 'asc' }, { scopeValue: 'asc' }] });
  }

  @Staff(StaffRole.FINANCE)
  @Put('commission-rules')
  async upsertRule(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(z.object({ scope: z.nativeEnum(CommissionScope), scopeValue: z.string().max(60).default(''), rateBps: z.number().int().min(0).max(5000), serviceFeeMinor: zMinor.default(0), active: z.boolean().default(true) }), body);
    if (input.scope === CommissionScope.DEFAULT) input.scopeValue = '';
    else if (!input.scopeValue) throw new BadRequestException('scopeValue is required');
    const before = await this.prisma.commissionRule.findUnique({ where: { scope_scopeValue: { scope: input.scope, scopeValue: input.scopeValue } } });
    const rule = await this.prisma.commissionRule.upsert({
      where: { scope_scopeValue: { scope: input.scope, scopeValue: input.scopeValue } },
      create: { ...input, createdById: auth.user.id },
      update: { rateBps: input.rateBps, serviceFeeMinor: input.serviceFeeMinor, active: input.active },
    });
    await this.audit.record({ actor: auth, action: 'commission.rule_changed', entityType: 'commission_rule', entityId: rule.id, metadata: { before, after: input }, ip: req.ip });
    return rule;
  }

  // ── Users & roles ──────────────────────────────────────────────────────

  @Staff(StaffRole.SUPER_ADMIN)
  @Get('users')
  async users(@Query() query: unknown) {
    const q = parse(zPage.extend({ q: z.string().max(100).optional(), staff: z.enum(['true', 'false']).optional() }), query);
    const where = {
      ...(q.q ? { OR: [{ email: { contains: q.q, mode: 'insensitive' as const } }, { name: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
      ...(q.staff === 'true' ? { NOT: { staffRoles: { isEmpty: true } } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q), select: { id: true, email: true, name: true, status: true, staffRoles: true, mfaEnabled: true, createdAt: true } }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  @Staff(StaffRole.SUPER_ADMIN)
  @Put('users/:id/roles')
  async setRoles(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: KdcnRequest) {
    const { staffRoles } = parse(z.object({ staffRoles: z.array(z.nativeEnum(StaffRole)).max(4) }), body);
    if (id === auth.user.id && !staffRoles.includes(StaffRole.SUPER_ADMIN)) throw new BadRequestException('You cannot remove your own super-admin role');
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException();
    await this.prisma.user.update({ where: { id }, data: { staffRoles: [...new Set(staffRoles)] } });
    await this.sessions.revokeAllForUser(id); // force re-authentication (and MFA) with the new roles
    await this.audit.record({ actor: auth, action: 'user.staff_roles_changed', entityType: 'user', entityId: id, metadata: { before: before.staffRoles, after: staffRoles }, ip: req.ip });
    return { ok: true };
  }

  @Staff(StaffRole.SUPER_ADMIN, StaffRole.SUPPORT)
  @Post('users/:id/status')
  @HttpCode(200)
  async setStatus(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: KdcnRequest) {
    const { status, reason } = parse(z.object({ status: z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED]), reason: zText(300).min(3) }), body);
    if (id === auth.user.id) throw new BadRequestException('You cannot change your own status');
    await this.prisma.user.update({ where: { id }, data: { status } });
    if (status === UserStatus.SUSPENDED) await this.sessions.revokeAllForUser(id);
    await this.audit.record({ actor: auth, action: 'user.status_changed', entityType: 'user', entityId: id, metadata: { status, reason }, ip: req.ip });
    return { ok: true };
  }

  // ── Audit ──────────────────────────────────────────────────────────────

  @Staff(StaffRole.SUPER_ADMIN, StaffRole.FINANCE, StaffRole.OPERATIONS)
  @Get('audit')
  async auditLog(@Query() query: unknown) {
    const q = parse(zPage.extend({ entityType: z.string().max(40).optional(), entityId: z.string().max(100).optional(), actorUserId: zId.optional(), action: z.string().max(80).optional() }), query);
    const where = { entityType: q.entityType, entityId: q.entityId, actorUserId: q.actorUserId, ...(q.action ? { action: { startsWith: q.action } } : {}) };
    const [items, total] = await Promise.all([this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }), this.prisma.auditEvent.count({ where })]);
    return { items, total };
  }

  // ── Reports & reviews moderation ───────────────────────────────────────

  @Staff(StaffRole.SUPPORT, StaffRole.OPERATIONS)
  @Get('reports')
  async reports(@Query() query: unknown) {
    const q = parse(z.object({ status: z.nativeEnum(ReportStatus).default(ReportStatus.OPEN) }), query);
    return this.prisma.abuseReport.findMany({ where: { status: q.status }, orderBy: { createdAt: 'asc' }, take: 200 });
  }

  @Staff(StaffRole.SUPPORT, StaffRole.OPERATIONS)
  @Post('reports/:id')
  @HttpCode(200)
  async resolveReport(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(z.object({ status: z.enum([ReportStatus.ACTIONED, ReportStatus.DISMISSED]), resolution: zText(500).min(3) }), body);
    const r = await this.prisma.abuseReport.update({ where: { id }, data: { status: input.status, resolution: input.resolution, resolvedById: auth.user.id } });
    await this.audit.record({ actor: auth, action: 'report.resolved', entityType: 'report', entityId: id, metadata: input, ip: req.ip });
    return r;
  }

  @Staff(StaffRole.SUPPORT, StaffRole.OPERATIONS)
  @Get('reviews')
  async reviewQueue(@Query() query: unknown) {
    const q = parse(z.object({ status: z.nativeEnum(ReviewStatus).default(ReviewStatus.FLAGGED) }), query);
    return this.prisma.review.findMany({ where: { status: q.status }, orderBy: { createdAt: 'desc' }, take: 200, include: { merchant: { select: { displayName: true } }, order: { select: { number: true } } } });
  }

  @Staff(StaffRole.SUPPORT, StaffRole.OPERATIONS)
  @Post('reviews/:id/moderate')
  @HttpCode(204)
  async moderateReview(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(z.object({ status: z.nativeEnum(ReviewStatus), reason: zText(500).min(3) }), body);
    await this.reviews.moderate(id, auth, input.status, input.reason, req.ip);
  }

  // ── Markets, operators, collection points ──────────────────────────────

  @Staff(StaffRole.OPERATIONS)
  @Post('markets')
  async createMarket(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(z.object({ slug: zSlug, name: zText(80).min(2), kind: z.nativeEnum(MarketKind), cityId: zId, areaId: zId.optional(), tagline: zText(140).default(''), description: zText(4000).default(''), publicAddress: zText(200).default(''), branded: z.boolean().default(false) }), body);
    const m = await this.prisma.market.create({ data: input });
    await this.audit.record({ actor: auth, action: 'market.created', entityType: 'market', entityId: m.id, ip: req.ip });
    return m;
  }

  @Staff(StaffRole.OPERATIONS)
  @Get('markets')
  async markets() {
    return this.prisma.market.findMany({ orderBy: { name: 'asc' }, include: { operators: { include: { user: { select: { id: true, email: true, name: true } } } }, _count: { select: { affiliations: true, collectionPoints: true } } } });
  }

  @Staff(StaffRole.SUPER_ADMIN, StaffRole.OPERATIONS)
  @Post('markets/:id/operators')
  async addOperator(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(z.object({ email: z.string().trim().toLowerCase().email(), role: z.nativeEnum(OperatorRole) }), body);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) throw new NotFoundException('No user with that email — ask them to register first');
    const m = await this.prisma.marketOperatorMember.upsert({ where: { marketId_userId: { marketId: id, userId: user.id } }, create: { marketId: id, userId: user.id, role: input.role }, update: { role: input.role } });
    await this.audit.record({ actor: auth, action: 'market.operator_added', entityType: 'market', entityId: id, metadata: { userId: user.id, role: input.role }, ip: req.ip });
    return m;
  }

  @Staff(StaffRole.SUPER_ADMIN, StaffRole.OPERATIONS)
  @Delete('markets/:id/operators/:userId')
  @HttpCode(204)
  async removeOperator(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Req() req: KdcnRequest) {
    await this.prisma.marketOperatorMember.deleteMany({ where: { marketId: id, userId } });
    await this.audit.record({ actor: auth, action: 'market.operator_removed', entityType: 'market', entityId: id, metadata: { userId }, ip: req.ip });
  }

  @Staff(StaffRole.OPERATIONS)
  @Get('collection-points')
  async collectionPoints() {
    return this.prisma.collectionPoint.findMany({ orderBy: { name: 'asc' }, include: { market: { select: { name: true } }, area: { select: { name: true } } } });
  }

  @Staff(StaffRole.OPERATIONS)
  @Post('collection-points')
  async createCollectionPoint(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: KdcnRequest) {
    const input = parse(z.object({ name: zText(80).min(3), areaId: zId, marketId: zId.nullable().optional(), publicAddress: zText(200).min(5), openingHours: zText(200).default(''), instructions: zText(500).default('') }), body);
    const cp = await this.prisma.collectionPoint.create({ data: input });
    await this.audit.record({ actor: auth, action: 'collection_point.created', entityType: 'collection_point', entityId: cp.id, ip: req.ip });
    return cp;
  }

  @Staff(StaffRole.SUPER_ADMIN)
  @Get('jobs')
  async jobStatus() {
    return this.jobs.status();
  }

  @Staff(StaffRole.SUPER_ADMIN)
  @Post('jobs/:name/run')
  @HttpCode(200)
  async runJob(@Auth() auth: AuthContext, @Param('name') name: string, @Req() req: KdcnRequest) {
    if (!this.jobs.jobs.some((j) => j.name === name)) throw new NotFoundException();
    const result = await this.jobs.runJob(name);
    await this.audit.record({ actor: auth, action: 'job.run_manually', entityType: 'job', entityId: name, metadata: { result }, ip: req.ip });
    return { result };
  }
}
