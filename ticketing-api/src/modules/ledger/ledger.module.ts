import { Module } from '@nestjs/common';
import { RefundRequests } from './refund-requests.js';

/**
 * Payment ledger (refund records and payment lookups) shared by the booking and
 * payment modules. It owns writes to `refunds`; booking and payment modules use
 * it instead of touching those rows directly (CLAUDE.md rule 5). Settlement still
 * crosses modules inside one transaction (BookingService.*InTx) because
 * invariant 4 requires booking, seats and payment to change atomically.
 */
@Module({
  providers: [RefundRequests],
  exports: [RefundRequests],
})
export class LedgerModule {}
