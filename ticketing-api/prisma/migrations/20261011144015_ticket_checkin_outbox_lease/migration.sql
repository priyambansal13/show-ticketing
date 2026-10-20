-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "checked_in_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "outbox" ADD COLUMN     "claimed_until" TIMESTAMPTZ(6);

-- Only confirmed bookings can be checked in.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_checked_in_chk" CHECK ("checked_in_at" IS NULL OR "status" = 'CONFIRMED');

-- Relay picks unclaimed (or lease-expired) pending rows in id order.
DROP INDEX "outbox_pending_idx";
CREATE INDEX "outbox_pending_idx" ON "outbox" ("id") WHERE "status" = 'PENDING';
CREATE INDEX "outbox_sent_at_idx" ON "outbox" ("sent_at") WHERE "status" = 'SENT';

-- Refund payout scanner: oldest PENDING refunds not yet submitted to the provider.
CREATE INDEX "refunds_unsubmitted_idx" ON "refunds" ("created_at") WHERE "status" = 'PENDING' AND "provider_refund_id" IS NULL;
-- Refund reconciler: submitted refunds still awaiting the provider.
CREATE INDEX "refunds_submitted_pending_idx" ON "refunds" ("updated_at") WHERE "status" = 'PENDING' AND "provider_refund_id" IS NOT NULL;
-- Housekeeping of webhook dedupe rows.
CREATE INDEX "processed_webhooks_received_at_idx" ON "processed_webhooks" ("received_at");
