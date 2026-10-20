-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'BOOKED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'CAPTURED_DUPLICATE', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20),
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "user_agent" VARCHAR(512),
    "ip" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_profiles" (
    "user_id" UUID NOT NULL,
    "org_name" VARCHAR(200) NOT NULL,
    "contact_phone" VARCHAR(20),
    "tax_id" VARCHAR(32),
    "verified_at" TIMESTAMPTZ(6),
    "verified_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manager_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "show_seats" (
    "id" UUID NOT NULL,
    "show_id" CHAR(24) NOT NULL,
    "event_id" CHAR(24) NOT NULL,
    "seat_id" VARCHAR(16) NOT NULL,
    "section" VARCHAR(32) NOT NULL,
    "row_label" VARCHAR(8) NOT NULL,
    "seat_number" INTEGER NOT NULL,
    "price_tier" VARCHAR(32) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "SeatStatus" NOT NULL DEFAULT 'AVAILABLE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "booking_id" UUID,
    "hold_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "show_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "booking_ref" VARCHAR(12) NOT NULL,
    "user_id" UUID NOT NULL,
    "show_id" CHAR(24) NOT NULL,
    "event_id" CHAR(24) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "total_amount" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "idempotency_key" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_items" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "show_seat_id" UUID NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_order_id" VARCHAR(64),
    "provider_payment_id" VARCHAR(64),
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "idempotency_key" VARCHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "raw_response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "provider_refund_id" VARCHAR(64),
    "idempotency_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_webhooks" (
    "provider" VARCHAR(20) NOT NULL,
    "provider_event_id" VARCHAR(128) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhooks_pkey" PRIMARY KEY ("provider","provider_event_id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" VARCHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "route" VARCHAR(128) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id","route","key")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" BIGSERIAL NOT NULL,
    "aggregate" VARCHAR(32) NOT NULL,
    "aggregate_id" VARCHAR(64) NOT NULL,
    "topic" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "actor_role" "Role",
    "action" VARCHAR(64) NOT NULL,
    "entity" VARCHAR(32) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "payload" JSONB,
    "ip" VARCHAR(45),
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_role_key" ON "users"("email", "role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "show_seats_show_id_status_idx" ON "show_seats"("show_id", "status");

-- CreateIndex
CREATE INDEX "show_seats_booking_id_idx" ON "show_seats"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "show_seats_show_id_seat_id_key" ON "show_seats"("show_id", "seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_ref_key" ON "bookings"("booking_ref");

-- CreateIndex
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_show_id_status_idx" ON "bookings"("show_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_user_id_idempotency_key_key" ON "bookings"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "booking_items_show_seat_id_idx" ON "booking_items"("show_seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_items_booking_id_show_seat_id_key" ON "booking_items"("booking_id", "show_seat_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_order_id_key" ON "payments"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "refunds"("provider_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_profiles" ADD CONSTRAINT "manager_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_profiles" ADD CONSTRAINT "manager_profiles_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_seats" ADD CONSTRAINT "show_seats_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_show_seat_id_fkey" FOREIGN KEY ("show_seat_id") REFERENCES "show_seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Hand-written invariants (not expressible in Prisma schema).
-- Keep in sync with docs/IMPLEMENTATION_PLAN.md §4.1 and the booking-integrity skill.
-- ═══════════════════════════════════════════════════════════════════════════

-- Identity -------------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_email_format_chk"    CHECK ("email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Inventory ------------------------------------------------------------------
-- Seat ownership must match seat status:
--   AVAILABLE / BLOCKED → no booking, no hold expiry
--   HELD               → booking + hold expiry
--   BOOKED             → booking, no hold expiry
ALTER TABLE "show_seats"
  ADD CONSTRAINT "show_seats_price_chk"        CHECK ("price" > 0),  -- free seats are out of scope (no zero-amount payment path)
  ADD CONSTRAINT "show_seats_seat_number_chk"  CHECK ("seat_number" > 0),
  ADD CONSTRAINT "show_seats_version_chk"      CHECK ("version" >= 0),
  ADD CONSTRAINT "show_seats_status_owner_chk" CHECK (
    ("status" IN ('AVAILABLE', 'BLOCKED') AND "booking_id" IS NULL     AND "hold_expires_at" IS NULL) OR
    ("status" = 'HELD'                    AND "booking_id" IS NOT NULL AND "hold_expires_at" IS NOT NULL) OR
    ("status" = 'BOOKED'                  AND "booking_id" IS NOT NULL AND "hold_expires_at" IS NULL)
  );

-- Hold expiry has ONE clock: bookings.hold_expires_at. The sweeper drives off
-- bookings_pending_expiry_idx and releases the booking and its seats together;
-- show_seats.hold_expires_at must equal it (enforced by booking_consistency).

-- Booking --------------------------------------------------------------------
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_total_amount_chk" CHECK ("total_amount" > 0),
  ADD CONSTRAINT "bookings_currency_chk"     CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "bookings_confirmed_at_chk" CHECK ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL),
  ADD CONSTRAINT "bookings_cancelled_at_chk" CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);

-- Expiry sweeper: PENDING bookings ordered by hold expiry.
CREATE INDEX "bookings_pending_expiry_idx" ON "bookings" ("hold_expires_at") WHERE "status" = 'PENDING';

ALTER TABLE "booking_items"
  ADD CONSTRAINT "booking_items_price_chk" CHECK ("price" > 0);

-- Payments -------------------------------------------------------------------
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_chk"   CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "payments_attempts_chk" CHECK ("attempts" >= 0);

-- A booking can be paid (captured) at most once.
CREATE UNIQUE INDEX "payments_one_captured_per_booking_idx" ON "payments" ("booking_id") WHERE "status" = 'CAPTURED';

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_chk" CHECK ("amount" > 0);

-- Messaging ------------------------------------------------------------------
-- Outbox relay polls pending rows in insertion order (FOR UPDATE SKIP LOCKED).
CREATE INDEX "outbox_pending_idx" ON "outbox" ("id") WHERE "status" = 'PENDING';

-- Cross-table integrity (booking-integrity review) -----------------------------
-- Mongo ids are 24 lower-case hex chars (must match Redis keys / Mongo documents).
ALTER TABLE "show_seats"
  ADD CONSTRAINT "show_seats_show_id_chk"  CHECK ("show_id"  ~ '^[0-9a-f]{24}$'),
  ADD CONSTRAINT "show_seats_event_id_chk" CHECK ("event_id" ~ '^[0-9a-f]{24}$'),
  ADD CONSTRAINT "show_seats_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_show_id_chk"  CHECK ("show_id"  ~ '^[0-9a-f]{24}$'),
  ADD CONSTRAINT "bookings_event_id_chk" CHECK ("event_id" ~ '^[0-9a-f]{24}$');

-- 1) Allowed state transitions (checked immediately, row by row) ---------------
CREATE FUNCTION enforce_seat_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('AVAILABLE', 'BLOCKED') THEN
      RAISE EXCEPTION 'show_seats: new seats must be AVAILABLE or BLOCKED, got %', NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'show_seats_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (
    ('AVAILABLE', 'HELD'), ('HELD', 'BOOKED'), ('HELD', 'AVAILABLE'),
    ('BOOKED', 'AVAILABLE'), ('AVAILABLE', 'BLOCKED'), ('BLOCKED', 'AVAILABLE')
  ) THEN
    RAISE EXCEPTION 'show_seats: illegal transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'show_seats_transition';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER show_seats_transition
  BEFORE INSERT OR UPDATE OF status ON "show_seats"
  FOR EACH ROW EXECUTE FUNCTION enforce_seat_transition();

CREATE FUNCTION enforce_booking_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'bookings: new bookings must be PENDING, got %', NEW.status
        USING ERRCODE = 'check_violation', CONSTRAINT = 'bookings_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  -- EXPIRED -> CONFIRMED is the late-payment path: allowed only when every seat
  -- is re-held and booked in the same transaction (verified at commit below).
  IF (OLD.status, NEW.status) NOT IN (
    ('PENDING', 'CONFIRMED'), ('PENDING', 'EXPIRED'), ('PENDING', 'FAILED'),
    ('EXPIRED', 'CONFIRMED'), ('CONFIRMED', 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'bookings: illegal transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'bookings_transition';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER bookings_transition
  BEFORE INSERT OR UPDATE OF status ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION enforce_booking_transition();

-- 2) Seat <-> booking <-> payment consistency (deferred to COMMIT so a confirm
--    can update payment, booking and seats in any order within one transaction)
CREATE FUNCTION assert_booking_consistent(p_booking_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  b       bookings%ROWTYPE;
  n_items int;
  items_total numeric;
  bad     text;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Items: at least one, all from the booking's show, same currency, total matches.
  SELECT count(*), coalesce(sum(bi.price), 0) INTO n_items, items_total
    FROM booking_items bi WHERE bi.booking_id = b.id;
  IF n_items = 0 THEN
    RAISE EXCEPTION 'booking %: has no items', b.id USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_consistency';
  END IF;
  IF items_total <> b.total_amount THEN
    RAISE EXCEPTION 'booking %: total_amount % <> sum of items %', b.id, b.total_amount, items_total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_consistency';
  END IF;
  SELECT s.seat_id INTO bad FROM booking_items bi JOIN show_seats s ON s.id = bi.show_seat_id
   WHERE bi.booking_id = b.id AND (s.show_id <> b.show_id OR s.currency <> b.currency) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'booking %: seat % belongs to another show or currency', b.id, bad
      USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_consistency';
  END IF;

  -- Seats owned by this booking must be its items, from its show, in a state its status allows.
  SELECT s.seat_id INTO bad FROM show_seats s
   WHERE s.booking_id = b.id
     AND (
       s.show_id <> b.show_id
       OR NOT EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id = b.id AND bi.show_seat_id = s.id)
       OR (s.status = 'HELD'   AND (b.status <> 'PENDING' OR s.hold_expires_at <> b.hold_expires_at))
       OR (s.status = 'BOOKED' AND (b.status <> 'CONFIRMED'
             OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status = 'CAPTURED')))
     )
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'booking % (%): seat % is in a state the booking does not allow', b.id, b.status, bad
      USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_consistency';
  END IF;

  -- A CONFIRMED booking owns every one of its items as BOOKED.
  IF b.status = 'CONFIRMED' THEN
    SELECT s.seat_id INTO bad FROM booking_items bi JOIN show_seats s ON s.id = bi.show_seat_id
     WHERE bi.booking_id = b.id AND (s.booking_id IS DISTINCT FROM b.id OR s.status <> 'BOOKED') LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'booking %: CONFIRMED but seat % is not BOOKED by it', b.id, bad
        USING ERRCODE = 'check_violation', CONSTRAINT = 'booking_consistency';
    END IF;
  END IF;
END $$;

CREATE FUNCTION check_booking_consistency_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'bookings' THEN
    PERFORM assert_booking_consistent(NEW.id);
  ELSIF TG_TABLE_NAME = 'show_seats' THEN
    IF TG_OP = 'UPDATE' AND OLD.booking_id IS NOT NULL THEN
      PERFORM assert_booking_consistent(OLD.booking_id);
    END IF;
    IF NEW.booking_id IS NOT NULL THEN
      PERFORM assert_booking_consistent(NEW.booking_id);
    END IF;
  ELSE -- booking_items, payments
    PERFORM assert_booking_consistent(NEW.booking_id);
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER bookings_consistency
  AFTER INSERT OR UPDATE ON "bookings" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_booking_consistency_trg();
CREATE CONSTRAINT TRIGGER show_seats_consistency
  AFTER INSERT OR UPDATE ON "show_seats" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_booking_consistency_trg();
CREATE CONSTRAINT TRIGGER booking_items_consistency
  AFTER INSERT OR UPDATE ON "booking_items" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_booking_consistency_trg();
CREATE CONSTRAINT TRIGGER payments_consistency
  AFTER INSERT OR UPDATE ON "payments" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_booking_consistency_trg();

-- 3) Payment matches its booking (immediate) -----------------------------------
CREATE FUNCTION enforce_payment_matches_booking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  b bookings%ROWTYPE;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = NEW.booking_id;
  IF NEW.amount <> b.total_amount OR NEW.currency <> b.currency THEN
    RAISE EXCEPTION 'payment for booking %: % % does not match booking total % %',
      b.id, NEW.amount, NEW.currency, b.total_amount, b.currency
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payments_match_booking';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_match_booking
  BEFORE INSERT OR UPDATE OF amount, currency, booking_id ON "payments"
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_matches_booking();

-- 4) Refunds never exceed the captured amount (serialized per payment) ----------
CREATE FUNCTION enforce_refund_bounds() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p        payments%ROWTYPE;
  refunded numeric;
BEGIN
  -- Lock the payment row so concurrent refunds for it are checked one at a time.
  SELECT * INTO p FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF p.status NOT IN ('CAPTURED', 'CAPTURED_DUPLICATE', 'REFUNDED') THEN
    RAISE EXCEPTION 'refund: payment % is %, only captured payments can be refunded', p.id, p.status
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_bounds';
  END IF;
  SELECT coalesce(sum(amount), 0) INTO refunded FROM refunds
   WHERE payment_id = NEW.payment_id AND status <> 'FAILED' AND id <> NEW.id;
  IF NEW.status <> 'FAILED' AND refunded + NEW.amount > p.amount THEN
    RAISE EXCEPTION 'refund: % + already refunded % exceeds payment amount %', NEW.amount, refunded, p.amount
      USING ERRCODE = 'check_violation', CONSTRAINT = 'refunds_bounds';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER refunds_bounds
  BEFORE INSERT OR UPDATE OF amount, status, payment_id ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION enforce_refund_bounds();
