-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT');

-- CreateEnum
CREATE TYPE "MerchantType" AS ENUM ('HOME_VENDOR', 'MALL_RETAILER', 'MARKET_TRADER', 'INDEPENDENT_SHOP');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RiskTier" AS ENUM ('STANDARD', 'ENHANCED');

-- CreateEnum
CREATE TYPE "MerchantRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "SettlementMode" AS ENUM ('PROVIDER_SPLIT', 'MANUAL_RECORD');

-- CreateEnum
CREATE TYPE "VerificationPathway" AS ENUM ('HOME_VENDOR_SOLE_TRADER', 'REGISTERED_BUSINESS', 'MARKET_RETAILER', 'ENHANCED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'INFO_REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VerificationDocType" AS ENUM ('GOVERNMENT_ID', 'CAC_CERTIFICATE', 'PROOF_OF_ADDRESS', 'TENANCY_OR_SHOP_ALLOCATION', 'SELFIE', 'FOOD_HANDLING_PERMIT', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('PUBLIC_STORE', 'PRIVATE_FULFILMENT');

-- CreateEnum
CREATE TYPE "FulfilmentMethod" AS ENUM ('IN_STORE_COLLECTION', 'COLLECTION_POINT', 'MERCHANT_DELIVERY', 'THIRD_PARTY_DELIVERY');

-- CreateEnum
CREATE TYPE "MarketKind" AS ENUM ('SHOPPING_MALL', 'TRADITIONAL_MARKET', 'COMMERCIAL_CLUSTER');

-- CreateEnum
CREATE TYPE "AffiliationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ENDED');

-- CreateEnum
CREATE TYPE "OperatorRole" AS ENUM ('MARKET_ADMIN', 'MARKET_EDITOR');

-- CreateEnum
CREATE TYPE "HomeVendorPolicy" AS ENUM ('ALLOWED', 'ENHANCED_REVIEW', 'PROHIBITED');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('APPROVED', 'PENDING_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'REMOVED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "StockMode" AS ENUM ('TRACKED', 'CONFIRM_ON_ORDER', 'MADE_TO_ORDER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_MERCHANT_CONFIRMATION', 'AWAITING_PAYMENT', 'PAYMENT_PENDING_VERIFICATION', 'PAID', 'ACCEPTED_FOR_FULFILMENT', 'PREPARING', 'READY_FOR_COLLECTION', 'DISPATCHED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "MerchantSegment" AS ENUM ('GALAXY_MALL', 'OTHER_MARKET', 'HOME_VENDOR', 'INDEPENDENT');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MOCK', 'PAYSTACK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING_FULFILMENT', 'ELIGIBLE', 'SETTLED', 'ON_HOLD', 'REVERSED');

-- CreateEnum
CREATE TYPE "CommissionScope" AS ENUM ('DEFAULT', 'MERCHANT_TYPE', 'MARKET', 'MERCHANT');

-- CreateEnum
CREATE TYPE "FulfilmentStatus" AS ENUM ('PENDING', 'PREPARING', 'READY_FOR_COLLECTION', 'AWAITING_PICKUP', 'DISPATCHED', 'DELIVERED', 'COLLECTED', 'FAILED_ATTEMPT', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'FLAGGED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('LISTING', 'MERCHANT', 'REVIEW');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'AWAITING_MERCHANT', 'UNDER_REVIEW', 'RESOLVED_REFUND', 'RESOLVED_NO_REFUND', 'CLOSED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('SEARCH', 'SEARCH_RESULT_CLICK', 'PRODUCT_VIEW', 'STOREFRONT_VIEW', 'ADD_TO_CART', 'CHECKOUT_STARTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "staffRoles" "StaffRole"[] DEFAULT ARRAY[]::"StaffRole"[],
    "mfaSecretEnc" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "userId" TEXT NOT NULL,
    "defaultAreaId" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "addressEnc" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "type" "MerchantType" NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'DRAFT',
    "riskTier" "RiskTier" NOT NULL DEFAULT 'STANDARD',
    "description" TEXT NOT NULL DEFAULT '',
    "logoKey" TEXT,
    "coverKey" TEXT,
    "publicAreaId" TEXT,
    "publicAreaLabel" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "whatsappNumber" TEXT,
    "instagramHandle" TEXT,
    "cacNumber" TEXT,
    "returnPolicy" TEXT NOT NULL DEFAULT '',
    "cancellationPolicy" TEXT NOT NULL DEFAULT '',
    "defaultLeadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "payoutBankCode" TEXT,
    "payoutAccountNumberEnc" TEXT,
    "payoutAccountName" TEXT,
    "providerSubaccountCode" TEXT,
    "settlementMode" "SettlementMode" NOT NULL DEFAULT 'MANUAL_RECORD',
    "approvedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspensionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_members" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MerchantRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_invitations" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MerchantRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_verifications" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "pathway" "VerificationPathway" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewerId" TEXT,
    "decisionNotes" TEXT,
    "requestNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "merchant_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_documents" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "type" "VerificationDocType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_locations" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL,
    "label" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "publicAddress" TEXT,
    "privateAddressEnc" TEXT,
    "marketId" TEXT,
    "unitLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_service_areas" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "deliveryFeeMinor" INTEGER NOT NULL,
    "etaDays" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "merchant_service_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_fulfilment_options" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "method" "FulfilmentMethod" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "collectionPointId" TEXT,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "instructions" TEXT NOT NULL DEFAULT '',
    "pickupFromMerchant" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "merchant_fulfilment_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "MarketKind" NOT NULL,
    "cityId" TEXT NOT NULL,
    "areaId" TEXT,
    "tagline" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "publicAddress" TEXT NOT NULL DEFAULT '',
    "coverKey" TEXT,
    "logoKey" TEXT,
    "openingHours" TEXT NOT NULL DEFAULT '',
    "branded" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_affiliations" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "status" "AffiliationStatus" NOT NULL DEFAULT 'PENDING',
    "unitLabel" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_operator_members" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OperatorRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_operator_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_announcements" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_points" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "marketId" TEXT,
    "areaId" TEXT NOT NULL,
    "publicAddress" TEXT NOT NULL,
    "openingHours" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "homeVendorPolicy" "HomeVendorPolicy" NOT NULL DEFAULT 'ALLOWED',

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "categoryId" TEXT NOT NULL,
    "brand" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "createdByMerchantId" TEXT NOT NULL,
    "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'APPROVED',
    "moderationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Standard',
    "options" JSONB NOT NULL DEFAULT '{}',
    "sku" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "stockMode" "StockMode" NOT NULL DEFAULT 'CONFIRM_ON_ORDER',
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "maxOrderQty" INTEGER NOT NULL DEFAULT 20,
    "returnPolicy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "searchVector" tsvector,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_variants" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "compareAtMinor" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "listing_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "listingVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("listingVariantId")
);

-- CreateTable
CREATE TABLE "product_collections" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "marketId" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_items" (
    "collectionId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("collectionId","listingId")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "listingVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "guestAccessHash" TEXT,
    "merchantId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "segment" "MerchantSegment" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "subtotalMinor" INTEGER NOT NULL,
    "deliveryFeeMinor" INTEGER NOT NULL,
    "serviceFeeMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "merchantSnapshot" JSONB NOT NULL,
    "termsSnapshot" JSONB NOT NULL,
    "fulfilmentMethod" "FulfilmentMethod" NOT NULL,
    "customerNote" TEXT,
    "merchantNote" TEXT,
    "cancellationReason" TEXT,
    "cancelledBy" TEXT,
    "confirmationDeadline" TIMESTAMP(3),
    "paymentDeadline" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "stockReserved" BOOLEAN NOT NULL DEFAULT false,
    "stockCommitted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "listingVariantId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    "stockMode" "StockMode" NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actorUserId" TEXT,
    "actorType" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "reference" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "providerTransactionId" TEXT,
    "providerFeeMinor" INTEGER,
    "channel" TEXT,
    "authorizationUrl" TEXT,
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "rawVerification" JSONB,
    "isTestMode" BOOLEAN NOT NULL DEFAULT true,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "result" TEXT,
    "deliveryCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "approvedById" TEXT,
    "providerRefundId" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "disputeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_allocations" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "mode" "SettlementMode" NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL,
    "serviceFeeMinor" INTEGER NOT NULL,
    "deliveryFeeMinor" INTEGER NOT NULL,
    "merchantDeliveryMinor" INTEGER NOT NULL,
    "providerFeeMinor" INTEGER,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "merchantNetMinor" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING_FULFILMENT',
    "payoutReference" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "scope" "CommissionScope" NOT NULL,
    "scopeValue" TEXT NOT NULL DEFAULT '',
    "rateBps" INTEGER NOT NULL,
    "serviceFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfilments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "FulfilmentMethod" NOT NULL,
    "status" "FulfilmentStatus" NOT NULL DEFAULT 'PENDING',
    "collectionPointId" TEXT,
    "deliveryAreaId" TEXT,
    "deliveryAddressEnc" TEXT,
    "recipientPhone" TEXT,
    "collectionCodeEnc" TEXT,
    "chargeMinor" INTEGER NOT NULL DEFAULT 0,
    "logisticsCostMinor" INTEGER,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "providerRef" TEXT,
    "pickupFromMerchant" BOOLEAN NOT NULL DEFAULT false,
    "scheduledPickupAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfilments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_assignments" (
    "id" TEXT NOT NULL,
    "fulfilmentId" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "riderName" TEXT,
    "riderPhone" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fulfilment_events" (
    "id" TEXT NOT NULL,
    "fulfilmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfilment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "merchantResponse" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_reports" (
    "id" TEXT NOT NULL,
    "targetType" "ReportTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "resolution" TEXT,
    "priorOrderStatus" "OrderStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidenceKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiries" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "listingId" TEXT,
    "customerId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "merchantId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "userId" TEXT,
    "merchantId" TEXT,
    "listingId" TEXT,
    "query" TEXT,
    "resultCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_leases" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_leases_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "mock_provider_charges" (
    "reference" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mock_provider_charges_pkey" PRIMARY KEY ("reference")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "customer_addresses_userId_idx" ON "customer_addresses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cities_slug_key" ON "cities"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "areas_cityId_slug_key" ON "areas"("cityId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_slug_key" ON "merchants"("slug");

-- CreateIndex
CREATE INDEX "merchants_status_type_idx" ON "merchants"("status", "type");

-- CreateIndex
CREATE INDEX "merchant_members_userId_idx" ON "merchant_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_members_merchantId_userId_key" ON "merchant_members"("merchantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_invitations_tokenHash_key" ON "merchant_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "merchant_invitations_merchantId_idx" ON "merchant_invitations"("merchantId");

-- CreateIndex
CREATE INDEX "merchant_verifications_status_idx" ON "merchant_verifications"("status");

-- CreateIndex
CREATE INDEX "merchant_verifications_merchantId_idx" ON "merchant_verifications"("merchantId");

-- CreateIndex
CREATE INDEX "merchant_locations_merchantId_idx" ON "merchant_locations"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_service_areas_merchantId_areaId_key" ON "merchant_service_areas"("merchantId", "areaId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_fulfilment_options_merchantId_method_collectionPoi_key" ON "merchant_fulfilment_options"("merchantId", "method", "collectionPointId");

-- CreateIndex
CREATE UNIQUE INDEX "markets_slug_key" ON "markets"("slug");

-- CreateIndex
CREATE INDEX "market_affiliations_marketId_status_idx" ON "market_affiliations"("marketId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "market_affiliations_merchantId_marketId_key" ON "market_affiliations"("merchantId", "marketId");

-- CreateIndex
CREATE UNIQUE INDEX "market_operator_members_marketId_userId_key" ON "market_operator_members"("marketId", "userId");

-- CreateIndex
CREATE INDEX "market_announcements_marketId_published_idx" ON "market_announcements"("marketId", "published");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "product_images_productId_idx" ON "product_images"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "listings_slug_key" ON "listings"("slug");

-- CreateIndex
CREATE INDEX "listings_status_idx" ON "listings"("status");

-- CreateIndex
CREATE INDEX "listings_merchantId_status_idx" ON "listings"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "listings_merchantId_productId_key" ON "listings"("merchantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "listing_variants_listingId_productVariantId_key" ON "listing_variants"("listingId", "productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "product_collections_slug_key" ON "product_collections"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "carts_guestTokenHash_key" ON "carts"("guestTokenHash");

-- CreateIndex
CREATE INDEX "carts_userId_idx" ON "carts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_listingVariantId_key" ON "cart_items"("cartId", "listingVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_idempotencyKey_key" ON "checkout_sessions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_orderId_key" ON "checkout_sessions"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE INDEX "orders_merchantId_status_idx" ON "orders"("merchantId", "status");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_events_orderId_idx" ON "order_events"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_reference_key" ON "payment_transactions"("reference");

-- CreateIndex
CREATE INDEX "payment_transactions_orderId_idx" ON "payment_transactions"("orderId");

-- CreateIndex
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

-- CreateIndex
CREATE INDEX "provider_webhook_events_receivedAt_idx" ON "provider_webhook_events"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_events_provider_eventKey_key" ON "provider_webhook_events"("provider", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotencyKey_key" ON "refunds"("idempotencyKey");

-- CreateIndex
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_allocations_orderId_key" ON "settlement_allocations"("orderId");

-- CreateIndex
CREATE INDEX "settlement_allocations_merchantId_status_idx" ON "settlement_allocations"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commission_rules_scope_scopeValue_key" ON "commission_rules"("scope", "scopeValue");

-- CreateIndex
CREATE UNIQUE INDEX "fulfilments_orderId_key" ON "fulfilments"("orderId");

-- CreateIndex
CREATE INDEX "fulfilments_status_idx" ON "fulfilments"("status");

-- CreateIndex
CREATE INDEX "delivery_assignments_fulfilmentId_idx" ON "delivery_assignments"("fulfilmentId");

-- CreateIndex
CREATE INDEX "fulfilment_events_fulfilmentId_idx" ON "fulfilment_events"("fulfilmentId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_orderId_key" ON "reviews"("orderId");

-- CreateIndex
CREATE INDEX "reviews_merchantId_status_idx" ON "reviews"("merchantId", "status");

-- CreateIndex
CREATE INDEX "abuse_reports_status_idx" ON "abuse_reports"("status");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE INDEX "disputes_orderId_idx" ON "disputes"("orderId");

-- CreateIndex
CREATE INDEX "dispute_messages_disputeId_idx" ON "dispute_messages"("disputeId");

-- CreateIndex
CREATE INDEX "enquiries_merchantId_idx" ON "enquiries"("merchantId");

-- CreateIndex
CREATE INDEX "notifications_status_createdAt_idx" ON "notifications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_channel_idx" ON "notifications"("userId", "channel");

-- CreateIndex
CREATE INDEX "audit_events_entityType_entityId_idx" ON "audit_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_events_actorUserId_idx" ON "audit_events"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_type_createdAt_idx" ON "analytics_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_merchantId_type_idx" ON "analytics_events"("merchantId", "type");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_defaultAreaId_fkey" FOREIGN KEY ("defaultAreaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_publicAreaId_fkey" FOREIGN KEY ("publicAreaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_members" ADD CONSTRAINT "merchant_members_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_members" ADD CONSTRAINT "merchant_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_invitations" ADD CONSTRAINT "merchant_invitations_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_verifications" ADD CONSTRAINT "merchant_verifications_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "merchant_verifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_locations" ADD CONSTRAINT "merchant_locations_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_locations" ADD CONSTRAINT "merchant_locations_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_locations" ADD CONSTRAINT "merchant_locations_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_service_areas" ADD CONSTRAINT "merchant_service_areas_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_service_areas" ADD CONSTRAINT "merchant_service_areas_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_fulfilment_options" ADD CONSTRAINT "merchant_fulfilment_options_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_fulfilment_options" ADD CONSTRAINT "merchant_fulfilment_options_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "collection_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_affiliations" ADD CONSTRAINT "market_affiliations_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_affiliations" ADD CONSTRAINT "market_affiliations_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_operator_members" ADD CONSTRAINT "market_operator_members_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_operator_members" ADD CONSTRAINT "market_operator_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_announcements" ADD CONSTRAINT "market_announcements_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_points" ADD CONSTRAINT "collection_points_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_points" ADD CONSTRAINT "collection_points_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_createdByMerchantId_fkey" FOREIGN KEY ("createdByMerchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_variants" ADD CONSTRAINT "listing_variants_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_variants" ADD CONSTRAINT "listing_variants_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_listingVariantId_fkey" FOREIGN KEY ("listingVariantId") REFERENCES "listing_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collections" ADD CONSTRAINT "product_collections_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "product_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_listingVariantId_fkey" FOREIGN KEY ("listingVariantId") REFERENCES "listing_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_listingVariantId_fkey" FOREIGN KEY ("listingVariantId") REFERENCES "listing_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_allocations" ADD CONSTRAINT "settlement_allocations_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfilments" ADD CONSTRAINT "fulfilments_collectionPointId_fkey" FOREIGN KEY ("collectionPointId") REFERENCES "collection_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_assignments" ADD CONSTRAINT "delivery_assignments_fulfilmentId_fkey" FOREIGN KEY ("fulfilmentId") REFERENCES "fulfilments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfilment_events" ADD CONSTRAINT "fulfilment_events_fulfilmentId_fkey" FOREIGN KEY ("fulfilmentId") REFERENCES "fulfilments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

