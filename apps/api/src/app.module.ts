import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { env } from './config/env';
import { AuthGuard } from './common/auth/auth.guard';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { AdminMerchantsController } from './modules/admin/admin-merchants.controller';
import { AdminOrdersController } from './modules/admin/admin-orders.controller';
import { AdminPlatformController } from './modules/admin/admin-platform.controller';
import { AnalyticsController } from './modules/analytics/analytics.controller';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { AuthController } from './modules/auth/auth.controller';
import { CartController } from './modules/cart/cart.controller';
import { CartService } from './modules/cart/cart.service';
import { ListingCardService } from './modules/catalog/listing-card.service';
import { MerchantListingsController } from './modules/catalog/merchant-listings.controller';
import { PublicCatalogController } from './modules/catalog/public.controller';
import { CheckoutController } from './modules/checkout/checkout.controller';
import { CheckoutService } from './modules/checkout/checkout.service';
import { DisputesService, ReviewsService } from './modules/disputes/disputes.service';
import { FulfilmentService } from './modules/fulfilment/fulfilment.service';
import { HealthController } from './modules/health.controller';
import { JobsService } from './modules/jobs/jobs.service';
import { OperatorController } from './modules/markets/operator.controller';
import { MerchantVerificationService } from './modules/merchants/merchant-verification.service';
import { MerchantsController } from './modules/merchants/merchants.controller';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { InventoryService } from './modules/orders/inventory.service';
import { MerchantOrdersController } from './modules/orders/merchant-orders.controller';
import { OrderStateService } from './modules/orders/order-state.service';
import { OrdersController } from './modules/orders/orders.controller';
import { OrdersService } from './modules/orders/orders.service';
import { PaymentsController } from './modules/payments/payments.controller';
import { PaymentsService } from './modules/payments/payments.service';
import { ProviderRegistry } from './modules/payments/provider.registry';
import { RefundsService } from './modules/payments/refunds.service';
import { SearchService } from './modules/search/search.service';
import { CommissionService } from './modules/settlements/commission.service';
import { SettlementsService } from './modules/settlements/settlements.service';
import { MediaController } from './modules/storage/media.controller';

/**
 * Modular monolith. Domain boundaries are folders under src/modules with their own services;
 * they share one database and one deployable. See docs/ARCHITECTURE.md.
 */
@Module({
  imports: [
    CommonModule,
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: env().RATE_LIMIT_PER_MINUTE }] }),
  ],
  controllers: [
    HealthController,
    AuthController,
    MediaController,
    PublicCatalogController,
    MerchantsController,
    MerchantListingsController,
    CartController,
    CheckoutController,
    OrdersController,
    MerchantOrdersController,
    PaymentsController,
    NotificationsController,
    AnalyticsController,
    OperatorController,
    AdminMerchantsController,
    AdminOrdersController,
    AdminPlatformController,
  ],
  providers: [
    // Order matters: throttle first, then authenticate/authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    MerchantVerificationService,
    ListingCardService,
    SearchService,
    CartService,
    CommissionService,
    SettlementsService,
    InventoryService,
    OrderStateService,
    FulfilmentService,
    ProviderRegistry,
    RefundsService,
    PaymentsService,
    OrdersService,
    CheckoutService,
    DisputesService,
    ReviewsService,
    AnalyticsService,
    JobsService,
  ],
})
export class AppModule {}
