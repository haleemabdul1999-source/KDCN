import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  HomeVendorPolicy,
  ListingStatus,
  MerchantType,
  ModerationStatus,
  Prisma,
  RiskTier,
  StockMode,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Auth } from '../../common/auth/decorators';
import { AccessService } from '../../common/auth/access.service';
import { AuthContext, KdcnRequest } from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit.service';
import { PrismaService, Tx } from '../../common/prisma.service';
import { pageArgs, parse, slugify, zId, zPage, zText } from '../../common/validation';
import { mediaUrl } from '../merchants/merchant-public';
import { StorageService } from '../storage/storage.service';
import { availabilityFor } from './availability';

const priceMinor = z.number().int().min(100, 'minimum price is ₦1').max(2_000_000_000);

const variantSchema = z.object({
  id: zId.optional(), // listing variant id when updating
  name: z.string().trim().min(1).max(60).default('Standard'),
  options: z.record(z.string().max(30), z.string().max(60)).default({}),
  sku: zText(60).optional(),
  priceMinor,
  compareAtMinor: priceMinor.nullable().optional(),
  quantity: z.number().int().min(0).max(100_000).optional(),
  active: z.boolean().default(true),
});

const listingSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: zText(5000).default(''),
  categoryId: zId,
  brand: zText(60).optional(),
  attributes: z.record(z.string().max(40), z.string().max(200)).default({}),
  stockMode: z.nativeEnum(StockMode).default(StockMode.CONFIRM_ON_ORDER),
  leadTimeDays: z.number().int().min(0).max(90).default(0),
  minOrderQty: z.number().int().min(1).max(10_000).default(1),
  maxOrderQty: z.number().int().min(1).max(10_000).default(20),
  returnPolicy: zText(2000).nullable().optional(),
  variants: z.array(variantSchema).min(1).max(30),
  publish: z.boolean().default(false),
});

const updateSchema = listingSchema
  .partial()
  .extend({ variants: z.array(variantSchema).min(1).max(30).optional() });

@Controller('merchant/:merchantId/listings')
export class MerchantListingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Query() query: unknown,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    const q = parse(
      zPage.extend({
        status: z.nativeEnum(ListingStatus).optional(),
        q: z.string().max(100).optional(),
      }),
      query,
    );
    const where: Prisma.ListingWhereInput = {
      merchantId,
      status: q.status ?? { not: ListingStatus.REMOVED },
      ...(q.q ? { product: { title: { contains: q.q, mode: 'insensitive' } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        ...pageArgs(q),
        orderBy: { updatedAt: 'desc' },
        include: this.include(),
      }),
      this.prisma.listing.count({ where }),
    ]);
    return { items: rows.map((l) => this.serialize(l)), total, page: q.page, pageSize: q.pageSize };
  }

  @Get(':listingId')
  async get(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    return this.serialize(await this.find(merchantId, listingId));
  }

  @Post()
  async create(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const member = await this.access.requireMerchant(auth, merchantId);
    const input = parse(listingSchema, body);
    this.checkQty(input.minOrderQty, input.maxOrderQty);
    const moderation = await this.moderationFor(member.merchant, input.categoryId);

    const listing = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
          brand: input.brand,
          attributes: input.attributes,
          createdByMerchantId: merchantId,
          moderationStatus: moderation,
          moderationNote:
            moderation === ModerationStatus.PENDING_REVIEW
              ? 'Restricted category: requires KDCN review'
              : null,
        },
      });
      const l = await tx.listing.create({
        data: {
          slug: `${slugify(input.title) || 'item'}-${randomBytes(3).toString('hex')}`,
          merchantId,
          productId: product.id,
          stockMode: input.stockMode,
          leadTimeDays: input.leadTimeDays,
          minOrderQty: input.minOrderQty,
          maxOrderQty: input.maxOrderQty,
          returnPolicy: input.returnPolicy ?? null,
          status: input.publish ? ListingStatus.ACTIVE : ListingStatus.DRAFT,
          publishedAt: input.publish ? new Date() : null,
        },
      });
      await this.syncVariants(tx, l.id, product.id, input.variants, input.stockMode);
      await this.audit.record(
        {
          actor: auth,
          action: 'listing.created',
          entityType: 'listing',
          entityId: l.id,
          merchantId,
          ip: req.ip,
        },
        tx,
      );
      return l;
    });
    return this.serialize(await this.find(merchantId, listing.id));
  }

  @Patch(':listingId')
  async update(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() body: unknown,
    @Req() req: KdcnRequest,
  ) {
    const member = await this.access.requireMerchant(auth, merchantId);
    const input = parse(updateSchema, body);
    const existing = await this.find(merchantId, listingId);
    if (existing.status === ListingStatus.BLOCKED)
      throw new ConflictException('This listing was blocked by moderation');
    this.checkQty(
      input.minOrderQty ?? existing.minOrderQty,
      input.maxOrderQty ?? existing.maxOrderQty,
    );
    const categoryChanged = input.categoryId && input.categoryId !== existing.product.categoryId;
    const moderation = categoryChanged
      ? await this.moderationFor(member.merchant, input.categoryId!)
      : undefined;
    const stockMode = input.stockMode ?? existing.stockMode;

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: existing.productId },
        data: {
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
          brand: input.brand,
          attributes: input.attributes,
          ...(moderation ? { moderationStatus: moderation } : {}),
        },
      });
      await tx.listing.update({
        where: { id: listingId },
        data: {
          stockMode: input.stockMode,
          leadTimeDays: input.leadTimeDays,
          minOrderQty: input.minOrderQty,
          maxOrderQty: input.maxOrderQty,
          returnPolicy: input.returnPolicy,
        },
      });
      if (input.variants)
        await this.syncVariants(tx, listingId, existing.productId, input.variants, stockMode);
      await this.audit.record(
        {
          actor: auth,
          action: 'listing.updated',
          entityType: 'listing',
          entityId: listingId,
          merchantId,
          metadata: { fields: Object.keys(input) },
          ip: req.ip,
        },
        tx,
      );
    });
    return this.serialize(await this.find(merchantId, listingId));
  }

  @Post(':listingId/status')
  @HttpCode(200)
  async setStatus(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Body() body: unknown,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    const { status } = parse(
      z.object({
        status: z.enum([ListingStatus.ACTIVE, ListingStatus.PAUSED, ListingStatus.REMOVED]),
      }),
      body,
    );
    const existing = await this.find(merchantId, listingId);
    if (existing.status === ListingStatus.BLOCKED)
      throw new ConflictException('This listing was blocked by moderation');
    if (status === ListingStatus.ACTIVE && !existing.variants.some((v) => v.active)) {
      throw new BadRequestException('Add at least one active price option before publishing');
    }
    await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status,
        publishedAt:
          status === ListingStatus.ACTIVE
            ? (existing.publishedAt ?? new Date())
            : existing.publishedAt,
      },
    });
    return this.serialize(await this.find(merchantId, listingId));
  }

  /** Set absolute stock for a TRACKED listing variant. Cannot go below currently reserved stock. */
  @Put(':listingId/inventory/:listingVariantId')
  async setInventory(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('listingVariantId', ParseUUIDPipe) listingVariantId: string,
    @Body() body: unknown,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    const { quantity } = parse(z.object({ quantity: z.number().int().min(0).max(100_000) }), body);
    const lv = await this.prisma.listingVariant.findFirst({
      where: { id: listingVariantId, listing: { id: listingId, merchantId } },
    });
    if (!lv) throw new NotFoundException('Listing variant not found');
    const updated = await this.prisma.$executeRaw`
      INSERT INTO inventory ("listingVariantId", quantity, reserved, "updatedAt") VALUES (${lv.id}, ${quantity}, 0, now())
      ON CONFLICT ("listingVariantId") DO UPDATE SET quantity = ${quantity}, "updatedAt" = now()
      WHERE inventory.reserved <= ${quantity}`;
    if (updated !== 1)
      throw new ConflictException('Quantity cannot be lower than stock reserved by open orders');
    return this.serialize(await this.find(merchantId, listingId));
  }

  @Post(':listingId/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async addImage(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    if (!file) throw new BadRequestException('file is required');
    const { alt } = parse(z.object({ alt: zText(200).default('') }), body ?? {});
    const listing = await this.find(merchantId, listingId);
    if (listing.product.createdByMerchantId !== merchantId) throw new NotFoundException();
    if (listing.product.images.length >= 8)
      throw new BadRequestException('A product can have at most 8 images');
    const stored = await this.storage.putImage('products', file.buffer);
    await this.prisma.productImage.create({
      data: {
        productId: listing.productId,
        storageKey: stored.key,
        alt,
        sortOrder: listing.product.images.length,
      },
    });
    return this.serialize(await this.find(merchantId, listingId));
  }

  @Delete(':listingId/images/:imageId')
  async removeImage(
    @Auth() auth: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    await this.access.requireMerchant(auth, merchantId);
    const listing = await this.find(merchantId, listingId);
    const res = await this.prisma.productImage.deleteMany({
      where: {
        id: imageId,
        productId: listing.productId,
        product: { createdByMerchantId: merchantId },
      },
    });
    if (!res.count) throw new NotFoundException('Image not found');
    return this.serialize(await this.find(merchantId, listingId));
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private checkQty(min: number, max: number) {
    if (max < min)
      throw new BadRequestException('Maximum order quantity must be at least the minimum');
  }

  private async moderationFor(
    merchant: { type: MerchantType; riskTier: RiskTier },
    categoryId: string,
  ): Promise<ModerationStatus> {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new BadRequestException('Unknown category');
    if (merchant.type !== MerchantType.HOME_VENDOR) return ModerationStatus.APPROVED;
    if (category.homeVendorPolicy === HomeVendorPolicy.PROHIBITED) {
      throw new BadRequestException(`Home vendors cannot sell in "${category.name}"`);
    }
    if (
      category.homeVendorPolicy === HomeVendorPolicy.ENHANCED_REVIEW &&
      merchant.riskTier !== RiskTier.ENHANCED
    ) {
      return ModerationStatus.PENDING_REVIEW;
    }
    return ModerationStatus.APPROVED;
  }

  private async syncVariants(
    tx: Tx,
    listingId: string,
    productId: string,
    variants: z.infer<typeof variantSchema>[],
    stockMode: StockMode,
  ) {
    const existing = await tx.listingVariant.findMany({
      where: { listingId },
      include: { inventory: true },
    });
    const keepIds = new Set(variants.filter((v) => v.id).map((v) => v.id!));
    for (const v of variants) {
      if (v.compareAtMinor != null && v.compareAtMinor <= v.priceMinor) {
        throw new BadRequestException('"Was" price must be higher than the selling price');
      }
      if (v.id) {
        const lv = existing.find((e) => e.id === v.id);
        if (!lv) throw new BadRequestException('Unknown variant id');
        await tx.productVariant.update({
          where: { id: lv.productVariantId },
          data: { name: v.name, options: v.options, sku: v.sku },
        });
        await tx.listingVariant.update({
          where: { id: lv.id },
          data: {
            priceMinor: v.priceMinor,
            compareAtMinor: v.compareAtMinor ?? null,
            active: v.active,
          },
        });
        if (stockMode === StockMode.TRACKED && v.quantity !== undefined) {
          const n = await tx.$executeRaw`
            INSERT INTO inventory ("listingVariantId", quantity, reserved, "updatedAt") VALUES (${lv.id}, ${v.quantity}, 0, now())
            ON CONFLICT ("listingVariantId") DO UPDATE SET quantity = ${v.quantity}, "updatedAt" = now()
            WHERE inventory.reserved <= ${v.quantity}`;
          if (n !== 1)
            throw new ConflictException(
              'Quantity cannot be lower than stock reserved by open orders',
            );
        }
      } else {
        const pv = await tx.productVariant.create({
          data: { productId, name: v.name, options: v.options, sku: v.sku },
        });
        const lv = await tx.listingVariant.create({
          data: {
            listingId,
            productVariantId: pv.id,
            priceMinor: v.priceMinor,
            compareAtMinor: v.compareAtMinor ?? null,
            active: v.active,
          },
        });
        await tx.inventory.create({
          data: {
            listingVariantId: lv.id,
            quantity: stockMode === StockMode.TRACKED ? (v.quantity ?? 0) : 0,
          },
        });
      }
    }
    // Variants omitted from the payload are deactivated (not deleted: order history references them).
    for (const e of existing) {
      if (!keepIds.has(e.id))
        await tx.listingVariant.update({ where: { id: e.id }, data: { active: false } });
    }
  }

  private include() {
    return {
      product: {
        include: { category: true, images: { orderBy: { sortOrder: 'asc' } }, variants: true },
      },
      variants: { include: { inventory: true, productVariant: true } },
    } satisfies Prisma.ListingInclude;
  }

  private async find(merchantId: string, listingId: string) {
    const l = await this.prisma.listing.findFirst({
      where: { id: listingId, merchantId },
      include: this.include(),
    });
    if (!l) throw new NotFoundException('Listing not found');
    return l;
  }

  private serialize(
    l: Prisma.ListingGetPayload<{ include: ReturnType<MerchantListingsController['include']> }>,
  ) {
    return {
      id: l.id,
      slug: l.slug,
      status: l.status,
      stockMode: l.stockMode,
      leadTimeDays: l.leadTimeDays,
      minOrderQty: l.minOrderQty,
      maxOrderQty: l.maxOrderQty,
      returnPolicy: l.returnPolicy,
      publishedAt: l.publishedAt,
      updatedAt: l.updatedAt,
      product: {
        id: l.product.id,
        title: l.product.title,
        description: l.product.description,
        brand: l.product.brand,
        attributes: l.product.attributes,
        category: {
          id: l.product.category.id,
          name: l.product.category.name,
          slug: l.product.category.slug,
        },
        moderationStatus: l.product.moderationStatus,
        moderationNote: l.product.moderationNote,
        images: l.product.images.map((i) => ({
          id: i.id,
          url: mediaUrl(i.storageKey),
          alt: i.alt,
        })),
      },
      variants: l.variants.map((v) => ({
        id: v.id,
        name: v.productVariant.name,
        options: v.productVariant.options,
        sku: v.productVariant.sku,
        priceMinor: v.priceMinor,
        compareAtMinor: v.compareAtMinor,
        active: v.active,
        quantity: v.inventory?.quantity ?? 0,
        reserved: v.inventory?.reserved ?? 0,
        availability: availabilityFor(l.stockMode, l.leadTimeDays, v.inventory),
      })),
    };
  }
}
