import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { AuditModule } from '../audit/audit.module.js';
import { BookingModule } from '../booking/booking.module.js';
import { EventsModule } from '../events/events.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';
import { FakePaymentProvider } from './providers/fake.provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.js';
import { RazorpayProvider } from './providers/razorpay.provider.js';

export function createPaymentProvider(config: ConfigService<Env, true>): PaymentProvider {
  if (config.get('PAYMENT_PROVIDER', { infer: true }) === 'razorpay') {
    const keys = (['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const).map((key) =>
      config.get(key, { infer: true }),
    );
    // Env validation already requires these; fail loudly rather than run with empty secrets.
    if (keys.some((value) => !value)) throw new Error('Razorpay credentials are not configured');
    const [keyId, keySecret, webhookSecret] = keys as [string, string, string];
    return new RazorpayProvider(keyId, keySecret, webhookSecret);
  }
  return new FakePaymentProvider(config.get('FAKE_PAYMENT_SECRET', { infer: true }));
}

@Module({
  imports: [BookingModule, EventsModule, InventoryModule, LedgerModule, AuditModule],
  controllers: [PaymentController],
  providers: [PaymentService, { provide: PAYMENT_PROVIDER, inject: [ConfigService], useFactory: createPaymentProvider }],
  exports: [PaymentService],
})
export class PaymentModule {}
