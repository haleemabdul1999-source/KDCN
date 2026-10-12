/* eslint-disable no-console */
/**
 * Seed script.
 *  - Reference data (always, idempotent): Kaduna city & neighbourhoods, categories, markets
 *    (Galaxy Mall + Kaduna Central Market), collection points, default commission rules.
 *  - Bootstrap super-admin (always, idempotent) from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 *  - Demo data (only when SEED_DEMO=true and NODE_ENV !== 'production'): fictional merchants,
 *    listings and accounts for local development and acceptance testing.
 *
 * Usage: pnpm --filter @kdcn/api db:seed
 */
import {
  HomeVendorPolicy,
  ListingStatus,
  LocationKind,
  MarketKind,
  MerchantRole,
  MerchantStatus,
  MerchantType,
  OperatorRole,
  PrismaClient,
  StaffRole,
  StockMode,
  VerificationPathway,
} from '@prisma/client';
import { encryptField, generateTotpSecret, hashPassword } from '../common/crypto';
import { env } from '../config/env';

let prisma: PrismaClient;

const KADUNA_AREAS = [
  'Barnawa',
  'Malali',
  'Ungwan Rimi',
  'Sabon Tasha',
  'Kawo',
  'Tudun Wada',
  'Narayi',
  'Kakuri',
  'Kaduna Central',
  'Badarawa',
  'Rigasa',
  'Gonin Gora',
  'Television',
  'Ungwan Sarki',
  'Kabala Costain',
  'Mando',
];

const CATEGORIES: {
  slug: string;
  name: string;
  policy?: HomeVendorPolicy;
  children?: { slug: string; name: string; policy?: HomeVendorPolicy }[];
}[] = [
  {
    slug: 'fashion',
    name: 'Fashion',
    children: [
      { slug: 'womens-clothing', name: "Women's clothing" },
      { slug: 'mens-clothing', name: "Men's clothing" },
      { slug: 'fabrics', name: 'Fabrics & Ankara' },
      { slug: 'shoes-bags', name: 'Shoes & bags' },
      { slug: 'jewellery', name: 'Jewellery & accessories' },
    ],
  },
  {
    slug: 'beauty',
    name: 'Beauty & personal care',
    policy: HomeVendorPolicy.ENHANCED_REVIEW,
    children: [
      { slug: 'skincare', name: 'Skincare', policy: HomeVendorPolicy.ENHANCED_REVIEW },
      { slug: 'hair', name: 'Hair & wigs' },
      { slug: 'fragrance', name: 'Fragrance', policy: HomeVendorPolicy.ENHANCED_REVIEW },
    ],
  },
  {
    slug: 'food',
    name: 'Food & baking',
    policy: HomeVendorPolicy.ENHANCED_REVIEW,
    children: [
      {
        slug: 'cakes-pastries',
        name: 'Cakes & pastries',
        policy: HomeVendorPolicy.ENHANCED_REVIEW,
      },
      { slug: 'snacks', name: 'Snacks & small chops', policy: HomeVendorPolicy.ENHANCED_REVIEW },
      { slug: 'groceries', name: 'Groceries & provisions' },
    ],
  },
  {
    slug: 'electronics',
    name: 'Phones & electronics',
    children: [
      { slug: 'phones', name: 'Phones & tablets' },
      { slug: 'accessories', name: 'Phone accessories' },
      { slug: 'appliances', name: 'Home appliances' },
    ],
  },
  {
    slug: 'home',
    name: 'Home & living',
    children: [
      { slug: 'kitchen', name: 'Kitchenware' },
      { slug: 'decor', name: 'Decor & crafts' },
      { slug: 'bedding', name: 'Bedding' },
    ],
  },
  {
    slug: 'baby-kids',
    name: 'Baby & kids',
    children: [
      { slug: 'kids-clothing', name: 'Kids clothing' },
      { slug: 'toys', name: 'Toys' },
    ],
  },
  {
    slug: 'health',
    name: 'Health & pharmacy',
    policy: HomeVendorPolicy.PROHIBITED,
    children: [{ slug: 'medicines', name: 'Medicines', policy: HomeVendorPolicy.PROHIBITED }],
  },
];

export async function seedReference(client: PrismaClient) {
  prisma = client;
  const kaduna = await prisma.city.upsert({
    where: { slug: 'kaduna' },
    update: {},
    create: { slug: 'kaduna', name: 'Kaduna', state: 'Kaduna' },
  });
  const areas: Record<string, string> = {};
  for (const name of KADUNA_AREAS) {
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    const a = await prisma.area.upsert({
      where: { cityId_slug: { cityId: kaduna.id, slug } },
      update: {},
      create: { cityId: kaduna.id, slug, name },
    });
    areas[name] = a.id;
  }
  let order = 0;
  for (const c of CATEGORIES) {
    const parent = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { homeVendorPolicy: c.policy ?? HomeVendorPolicy.ALLOWED },
      create: {
        slug: c.slug,
        name: c.name,
        sortOrder: order++,
        homeVendorPolicy: c.policy ?? HomeVendorPolicy.ALLOWED,
      },
    });
    for (const ch of c.children ?? []) {
      await prisma.category.upsert({
        where: { slug: ch.slug },
        update: { homeVendorPolicy: ch.policy ?? HomeVendorPolicy.ALLOWED, parentId: parent.id },
        create: {
          slug: ch.slug,
          name: ch.name,
          parentId: parent.id,
          sortOrder: order++,
          homeVendorPolicy: ch.policy ?? HomeVendorPolicy.ALLOWED,
        },
      });
    }
  }
  const galaxy = await prisma.market.upsert({
    where: { slug: 'galaxy-mall' },
    update: {},
    create: {
      slug: 'galaxy-mall',
      name: 'Galaxy Mall',
      kind: MarketKind.SHOPPING_MALL,
      cityId: kaduna.id,
      areaId: areas['Kaduna Central'],
      branded: true,
      tagline: 'Shop Galaxy Mall, Kaduna — online',
      description:
        'Browse participating Galaxy Mall stores, order online and collect in store or at the mall collection desk, or get it delivered across Kaduna.',
      publicAddress: 'Galaxy Mall, Kaduna',
      openingHours: 'Mon–Sat 9:00–20:00, Sun 12:00–19:00',
    },
  });
  await prisma.market.upsert({
    where: { slug: 'kaduna-central-market' },
    update: {},
    create: {
      slug: 'kaduna-central-market',
      name: 'Kaduna Central Market',
      kind: MarketKind.TRADITIONAL_MARKET,
      cityId: kaduna.id,
      areaId: areas['Kaduna Central'],
      tagline: 'Traders from Kaduna Central Market',
      description: 'Traditional market traders selling online through KDCN.',
      publicAddress: 'Kaduna Central Market, Kaduna',
    },
  });
  const galaxyDesk = await prisma.collectionPoint.findFirst({
    where: { name: 'Galaxy Mall Collection Desk' },
  });
  if (!galaxyDesk) {
    await prisma.collectionPoint.create({
      data: {
        name: 'Galaxy Mall Collection Desk',
        marketId: galaxy.id,
        areaId: areas['Kaduna Central'],
        publicAddress: 'Ground floor, by the main entrance, Galaxy Mall',
        openingHours: 'Mon–Sat 10:00–19:00',
        instructions: 'Show your collection code and a photo ID.',
      },
    });
  }
  const neutral = await prisma.collectionPoint.findFirst({
    where: { name: 'KDCN Pickup Point — Barnawa' },
  });
  if (!neutral) {
    await prisma.collectionPoint.create({
      data: {
        name: 'KDCN Pickup Point — Barnawa',
        areaId: areas['Barnawa'],
        publicAddress: 'KDCN partner pickup point, Barnawa (address shared on order confirmation)',
        openingHours: 'Mon–Sat 9:00–18:00',
        instructions: 'Neutral pickup point for home-vendor orders. Bring your collection code.',
      },
    });
  }
  await prisma.commissionRule.upsert({
    where: { scope_scopeValue: { scope: 'DEFAULT', scopeValue: '' } },
    update: {},
    create: { scope: 'DEFAULT', scopeValue: '', rateBps: 500, serviceFeeMinor: 10000 },
  });
  await prisma.commissionRule.upsert({
    where: { scope_scopeValue: { scope: 'MERCHANT_TYPE', scopeValue: 'HOME_VENDOR' } },
    update: {},
    create: {
      scope: 'MERCHANT_TYPE',
      scopeValue: 'HOME_VENDOR',
      rateBps: 400,
      serviceFeeMinor: 10000,
    },
  });
  await prisma.commissionRule.upsert({
    where: { scope_scopeValue: { scope: 'MARKET', scopeValue: galaxy.id } },
    update: {},
    create: { scope: 'MARKET', scopeValue: galaxy.id, rateBps: 450, serviceFeeMinor: 10000 },
  });
  if (process.env.NODE_ENV !== 'test') console.log('✓ reference data');
  return { kaduna, areas, galaxy };
}

async function admin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log(
      '• SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping super-admin bootstrap',
    );
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`• super-admin ${email} already exists`);
    return;
  }
  // In development a fixed TOTP secret may be supplied so testers can sign in; otherwise the admin
  // enrols MFA on first sign-in.
  const totp = process.env.SEED_ADMIN_TOTP_SECRET;
  await prisma.user.create({
    data: {
      email,
      name: 'KDCN Administrator',
      passwordHash: await hashPassword(password),
      staffRoles: [StaffRole.SUPER_ADMIN],
      mfaSecretEnc: totp ? encryptField(totp) : null,
      mfaEnabled: !!totp,
    },
  });
  console.log(
    `✓ super-admin ${email} created${totp ? ' (MFA pre-enrolled with SEED_ADMIN_TOTP_SECRET)' : ' (enrol MFA at first sign-in)'}`,
  );
}

async function demo(ref: Awaited<ReturnType<typeof seedReference>>) {
  if (env().NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  if (await prisma.merchant.findUnique({ where: { slug: 'zainab-fabrics' } })) {
    console.log('• demo data already present');
    return;
  }
  const pw = await hashPassword('Password123!');
  const mkUser = (email: string, name: string, phone: string, extra: object = {}) =>
    prisma.user.create({
      data: { email, name, phone, passwordHash: pw, customerProfile: { create: {} }, ...extra },
    });

  await mkUser('customer@demo.kdcn.ng', 'Halima Yusuf', '08030000001');
  const opsSecret = generateTotpSecret();
  await mkUser('ops@demo.kdcn.ng', 'Ops Officer', '08030000009', {
    staffRoles: [StaffRole.OPERATIONS, StaffRole.SUPPORT, StaffRole.FINANCE],
    mfaSecretEnc: encryptField(process.env.SEED_ADMIN_TOTP_SECRET ?? opsSecret),
    mfaEnabled: true,
  });
  const operator = await mkUser('operator@demo.kdcn.ng', 'Galaxy Mall Management', '08030000008');
  await prisma.marketOperatorMember.create({
    data: { marketId: ref.galaxy.id, userId: operator.id, role: OperatorRole.MARKET_ADMIN },
  });

  const cat = async (slug: string) =>
    (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;
  const galaxyDesk = await prisma.collectionPoint.findFirstOrThrow({
    where: { name: 'Galaxy Mall Collection Desk' },
  });
  const neutral = await prisma.collectionPoint.findFirstOrThrow({
    where: { name: 'KDCN Pickup Point — Barnawa' },
  });

  type DemoListing = {
    title: string;
    description: string;
    category: string;
    stockMode: StockMode;
    lead?: number;
    variants: { name: string; price: number; qty?: number }[];
  };
  const makeMerchant = async (opts: {
    slug: string;
    name: string;
    type: MerchantType;
    email: string;
    owner: string;
    phone: string;
    area: string;
    description: string;
    pathway: VerificationPathway;
    market?: boolean;
    listings: DemoListing[];
    fulfil: {
      method:
        | 'IN_STORE_COLLECTION'
        | 'COLLECTION_POINT'
        | 'MERCHANT_DELIVERY'
        | 'THIRD_PARTY_DELIVERY';
      cp?: string;
      fee?: number;
      pickup?: boolean;
    }[];
    serviceAreas?: [string, number][];
  }) => {
    const user = await mkUser(opts.email, opts.owner, opts.phone);
    const m = await prisma.merchant.create({
      data: {
        slug: opts.slug,
        displayName: opts.name,
        type: opts.type,
        status: MerchantStatus.APPROVED,
        approvedAt: new Date(),
        description: opts.description,
        contactEmail: opts.email,
        contactPhone: opts.phone,
        whatsappNumber: opts.phone,
        publicAreaId: ref.areas[opts.area],
        publicAreaLabel: `${opts.area}, Kaduna`,
        returnPolicy:
          'Returns accepted within 3 days for unused items in original packaging. Made-to-order items cannot be returned unless faulty.',
        cancellationPolicy:
          'Free cancellation before payment. After payment, cancel before the order is accepted for a full refund.',
        payoutBankCode: '058',
        payoutAccountNumberEnc: encryptField('0123456789'),
        payoutAccountName: opts.name,
        members: { create: { userId: user.id, role: MerchantRole.OWNER } },
        verifications: {
          create: {
            pathway: opts.pathway,
            status: 'APPROVED',
            decidedAt: new Date(),
            expiresAt: new Date(Date.now() + 365 * 86400_000),
            decisionNotes: 'Demo data',
          },
        },
      },
    });
    if (opts.market) {
      await prisma.marketAffiliation.create({
        data: {
          merchantId: m.id,
          marketId: ref.galaxy.id,
          status: 'APPROVED',
          unitLabel: 'Shop G14',
          decidedAt: new Date(),
        },
      });
      await prisma.merchantLocation.create({
        data: {
          merchantId: m.id,
          kind: LocationKind.PUBLIC_STORE,
          label: 'Galaxy Mall store',
          areaId: ref.areas['Kaduna Central'],
          publicAddress: 'Shop G14, Galaxy Mall, Kaduna',
          marketId: ref.galaxy.id,
          unitLabel: 'G14',
        },
      });
    } else if (opts.type === MerchantType.HOME_VENDOR) {
      await prisma.merchantLocation.create({
        data: {
          merchantId: m.id,
          kind: LocationKind.PRIVATE_FULFILMENT,
          label: 'Home kitchen',
          areaId: ref.areas[opts.area],
          privateAddressEnc: encryptField('No. 12 (demo) Private Close, ' + opts.area + ', Kaduna'),
        },
      });
    } else {
      await prisma.merchantLocation.create({
        data: {
          merchantId: m.id,
          kind: LocationKind.PUBLIC_STORE,
          label: 'Shop',
          areaId: ref.areas[opts.area],
          publicAddress: `14 Demo Road, ${opts.area}, Kaduna`,
        },
      });
    }
    for (const [area, fee] of opts.serviceAreas ?? []) {
      await prisma.merchantServiceArea.create({
        data: { merchantId: m.id, areaId: ref.areas[area], deliveryFeeMinor: fee, etaDays: 1 },
      });
    }
    for (const f of opts.fulfil) {
      await prisma.merchantFulfilmentOption.create({
        data: {
          merchantId: m.id,
          method: f.method,
          collectionPointId: f.cp ?? null,
          feeMinor: f.fee ?? 0,
          pickupFromMerchant: f.pickup ?? false,
        },
      });
    }
    let i = 0;
    for (const l of opts.listings) {
      const product = await prisma.product.create({
        data: {
          title: l.title,
          description: l.description,
          categoryId: await cat(l.category),
          createdByMerchantId: m.id,
        },
      });
      const listing = await prisma.listing.create({
        data: {
          slug: `${opts.slug}-${++i}`,
          merchantId: m.id,
          productId: product.id,
          status: ListingStatus.ACTIVE,
          stockMode: l.stockMode,
          leadTimeDays: l.lead ?? 0,
          publishedAt: new Date(Date.now() - i * 3600_000),
        },
      });
      for (const v of l.variants) {
        const pv = await prisma.productVariant.create({
          data: { productId: product.id, name: v.name },
        });
        const lv = await prisma.listingVariant.create({
          data: { listingId: listing.id, productVariantId: pv.id, priceMinor: v.price },
        });
        await prisma.inventory.create({ data: { listingVariantId: lv.id, quantity: v.qty ?? 0 } });
      }
    }
    return m;
  };

  await makeMerchant({
    slug: 'zainab-fabrics',
    name: 'Zainab Fabrics',
    type: MerchantType.MALL_RETAILER,
    email: 'galaxy.merchant@demo.kdcn.ng',
    owner: 'Zainab Bello',
    phone: '08030000002',
    area: 'Kaduna Central',
    description:
      'Quality Ankara, lace and George fabrics at Galaxy Mall. Tailoring referrals available.',
    pathway: VerificationPathway.MARKET_RETAILER,
    market: true,
    fulfil: [
      { method: 'IN_STORE_COLLECTION' },
      { method: 'COLLECTION_POINT', cp: galaxyDesk.id, fee: 0 },
      { method: 'THIRD_PARTY_DELIVERY', fee: 150000 },
    ],
    listings: [
      {
        title: 'Premium Ankara fabric — 6 yards',
        description: '100% cotton wax print, 6 yards. Colourfast.',
        category: 'fabrics',
        stockMode: StockMode.TRACKED,
        variants: [
          { name: 'Blue/Gold', price: 1850000, qty: 12 },
          { name: 'Red/Black', price: 1850000, qty: 4 },
        ],
      },
      {
        title: 'Swiss voile lace — 5 yards',
        description: 'Soft voile lace for occasions.',
        category: 'fabrics',
        stockMode: StockMode.CONFIRM_ON_ORDER,
        variants: [{ name: 'Champagne', price: 4500000 }],
      },
      {
        title: 'Men’s kaftan fabric bundle',
        description: 'Cashmere-feel kaftan material, 4 yards with cap fabric.',
        category: 'mens-clothing',
        stockMode: StockMode.TRACKED,
        variants: [{ name: 'Navy', price: 2200000, qty: 7 }],
      },
    ],
  });
  await makeMerchant({
    slug: 'amina-bakes',
    name: 'Amina Bakes',
    type: MerchantType.HOME_VENDOR,
    email: 'home.vendor@demo.kdcn.ng',
    owner: 'Amina Sani',
    phone: '08030000003',
    area: 'Barnawa',
    description:
      'Home baker in Barnawa. Celebration cakes, chin-chin and small chops made to order.',
    pathway: VerificationPathway.ENHANCED,
    fulfil: [
      { method: 'MERCHANT_DELIVERY' },
      { method: 'COLLECTION_POINT', cp: neutral.id, fee: 50000 },
      { method: 'THIRD_PARTY_DELIVERY', fee: 150000, pickup: true },
    ],
    serviceAreas: [
      ['Barnawa', 80000],
      ['Narayi', 100000],
      ['Sabon Tasha', 120000],
      ['Kakuri', 120000],
    ],
    listings: [
      {
        title: 'Celebration cake — 8 inch',
        description: 'Two-layer vanilla or chocolate sponge with buttercream. Message included.',
        category: 'cakes-pastries',
        stockMode: StockMode.MADE_TO_ORDER,
        lead: 2,
        variants: [
          { name: 'Vanilla', price: 2500000 },
          { name: 'Chocolate', price: 2800000 },
        ],
      },
      {
        title: 'Chin-chin — 1kg tub',
        description: 'Crunchy, lightly sweet chin-chin.',
        category: 'snacks',
        stockMode: StockMode.MADE_TO_ORDER,
        lead: 1,
        variants: [{ name: '1kg', price: 450000 }],
      },
    ],
  });
  await makeMerchant({
    slug: 'kawo-gadgets',
    name: 'Kawo Gadgets Hub',
    type: MerchantType.INDEPENDENT_SHOP,
    email: 'independent@demo.kdcn.ng',
    owner: 'Ibrahim Musa',
    phone: '08030000004',
    area: 'Kawo',
    description:
      'Phone accessories, chargers and power banks. Genuine products with 7-day warranty.',
    pathway: VerificationPathway.REGISTERED_BUSINESS,
    fulfil: [{ method: 'IN_STORE_COLLECTION' }, { method: 'MERCHANT_DELIVERY' }],
    serviceAreas: [
      ['Kawo', 50000],
      ['Malali', 80000],
      ['Ungwan Rimi', 80000],
      ['Kaduna Central', 100000],
    ],
    listings: [
      {
        title: '20,000mAh power bank',
        description: 'Fast-charging power bank, USB-C PD 20W.',
        category: 'accessories',
        stockMode: StockMode.TRACKED,
        variants: [{ name: 'Black', price: 1800000, qty: 25 }],
      },
      {
        title: 'USB-C fast charger 25W',
        description: 'Wall charger with USB-C cable.',
        category: 'accessories',
        stockMode: StockMode.TRACKED,
        variants: [{ name: 'White', price: 650000, qty: 40 }],
      },
      {
        title: 'Ankara print phone pouch',
        description: 'Handmade fabric pouch fits most phones.',
        category: 'accessories',
        stockMode: StockMode.TRACKED,
        variants: [{ name: 'Assorted', price: 250000, qty: 0 }],
      },
    ],
  });
  console.log('✓ demo data (password for all demo accounts: Password123!)');
}

async function main() {
  const client = new PrismaClient();
  try {
    const ref = await seedReference(client);
    await admin();
    if (process.env.SEED_DEMO === 'true') await demo(ref);
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
