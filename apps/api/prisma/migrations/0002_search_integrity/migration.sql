-- ─────────────────────────────────────────────────────────────────────────────
-- 0002: full-text search, data-integrity constraints and append-only audit log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Full-text search on listings ────────────────────────────────────────────
-- The listing search document combines product title (A), brand + category (B),
-- merchant name (B) and product description (C).
CREATE OR REPLACE FUNCTION kdcn_listing_search_vector(p_listing_id text) RETURNS tsvector
LANGUAGE sql STABLE AS $$
  SELECT
      setweight(to_tsvector('simple', coalesce(p.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p.title, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(p.brand, '') || ' ' || coalesce(c.name, '')), 'B')
    || setweight(to_tsvector('simple', coalesce(m."displayName", '')), 'B')
    || setweight(to_tsvector('english', coalesce(p.description, '')), 'C')
  FROM listings l
  JOIN products p ON p.id = l."productId"
  JOIN categories c ON c.id = p."categoryId"
  JOIN merchants m ON m.id = l."merchantId"
  WHERE l.id = p_listing_id
$$;

CREATE OR REPLACE FUNCTION kdcn_listings_search_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Recompute after insert/update of the listing row itself.
  UPDATE listings SET "searchVector" = kdcn_listing_search_vector(NEW.id)
  WHERE id = NEW.id AND "searchVector" IS DISTINCT FROM kdcn_listing_search_vector(NEW.id);
  RETURN NULL;
END $$;

CREATE TRIGGER listings_search_refresh
AFTER INSERT OR UPDATE OF "productId", "merchantId", status ON listings
FOR EACH ROW EXECUTE FUNCTION kdcn_listings_search_trigger();

CREATE OR REPLACE FUNCTION kdcn_products_search_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE listings SET "searchVector" = kdcn_listing_search_vector(id) WHERE "productId" = NEW.id;
  RETURN NULL;
END $$;

CREATE TRIGGER products_search_refresh
AFTER UPDATE OF title, description, brand, "categoryId" ON products
FOR EACH ROW EXECUTE FUNCTION kdcn_products_search_trigger();

CREATE OR REPLACE FUNCTION kdcn_merchants_search_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE listings SET "searchVector" = kdcn_listing_search_vector(id) WHERE "merchantId" = NEW.id;
  RETURN NULL;
END $$;

CREATE TRIGGER merchants_search_refresh
AFTER UPDATE OF "displayName" ON merchants
FOR EACH ROW EXECUTE FUNCTION kdcn_merchants_search_trigger();

CREATE INDEX listings_search_idx ON listings USING GIN ("searchVector");
CREATE INDEX products_title_trgm_idx ON products USING GIN (title gin_trgm_ops);
CREATE INDEX merchants_name_trgm_idx ON merchants USING GIN ("displayName" gin_trgm_ops);

-- ── Integrity constraints (defence in depth behind application validation) ──
ALTER TABLE inventory ADD CONSTRAINT inventory_quantity_nonneg CHECK (quantity >= 0);
ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_nonneg CHECK (reserved >= 0);
ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_lte_quantity CHECK (reserved <= quantity);

ALTER TABLE listing_variants ADD CONSTRAINT listing_variants_price_positive CHECK ("priceMinor" > 0);
ALTER TABLE listings ADD CONSTRAINT listings_qty_bounds CHECK ("minOrderQty" >= 1 AND "maxOrderQty" >= "minOrderQty");
ALTER TABLE listings ADD CONSTRAINT listings_lead_time_nonneg CHECK ("leadTimeDays" >= 0);
ALTER TABLE cart_items ADD CONSTRAINT cart_items_qty_positive CHECK (quantity > 0);

ALTER TABLE orders ADD CONSTRAINT orders_amounts_nonneg CHECK (
  "subtotalMinor" >= 0 AND "deliveryFeeMinor" >= 0 AND "serviceFeeMinor" >= 0
  AND "commissionMinor" >= 0 AND "commissionBps" BETWEEN 0 AND 10000);
ALTER TABLE orders ADD CONSTRAINT orders_total_consistent CHECK (
  "totalMinor" = "subtotalMinor" + "deliveryFeeMinor" + "serviceFeeMinor");
ALTER TABLE order_items ADD CONSTRAINT order_items_line_consistent CHECK (
  quantity > 0 AND "unitPriceMinor" >= 0 AND "lineTotalMinor" = "unitPriceMinor" * quantity);

ALTER TABLE payment_transactions ADD CONSTRAINT payments_amount_positive CHECK ("amountMinor" > 0);
-- At most one successful payment per order: prevents a second payment marking an order paid twice.
CREATE UNIQUE INDEX payment_one_success_per_order ON payment_transactions ("orderId") WHERE status = 'SUCCEEDED' AND "isDuplicate" = false;

ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive CHECK ("amountMinor" > 0);
ALTER TABLE settlement_allocations ADD CONSTRAINT settlement_refund_bounds CHECK (
  "refundedMinor" >= 0 AND "refundedMinor" <= "grossMinor" + "serviceFeeMinor" + "deliveryFeeMinor");

ALTER TABLE reviews ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE commission_rules ADD CONSTRAINT commission_rate_range CHECK ("rateBps" BETWEEN 0 AND 10000 AND "serviceFeeMinor" >= 0);
ALTER TABLE merchant_service_areas ADD CONSTRAINT service_area_fee_nonneg CHECK ("deliveryFeeMinor" >= 0 AND "etaDays" >= 0);

-- A merchant location is either public (has public address, no private) or private (vice versa).
ALTER TABLE merchant_locations ADD CONSTRAINT merchant_location_privacy CHECK (
  (kind = 'PUBLIC_STORE' AND "privateAddressEnc" IS NULL)
  OR (kind = 'PRIVATE_FULFILMENT' AND "publicAddress" IS NULL));

-- Only one open dispute per order.
CREATE UNIQUE INDEX disputes_one_open_per_order ON disputes ("orderId")
  WHERE status IN ('OPEN', 'AWAITING_MERCHANT', 'UNDER_REVIEW');

-- ── Append-only audit log ──
CREATE OR REPLACE FUNCTION kdcn_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END $$;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION kdcn_audit_immutable();
CREATE TRIGGER order_events_no_update BEFORE UPDATE OR DELETE ON order_events
FOR EACH ROW EXECUTE FUNCTION kdcn_audit_immutable();
