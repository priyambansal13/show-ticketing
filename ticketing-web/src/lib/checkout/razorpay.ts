'use client';

import type { CheckoutConfirmation, PaymentOrder } from '@/lib/api/types';

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the payment window. Check your connection.'));
    document.body.appendChild(script);
  });
}

/** Opens Razorpay Checkout; resolves with what /payments/verify needs, or null if the user closed it. */
export async function openRazorpay(order: PaymentOrder, prefill: { name?: string; email?: string }): Promise<CheckoutConfirmation | null> {
  await loadScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay || !order.publicKey || !order.orderId) throw new Error('Payment window unavailable');
  return new Promise((resolve, reject) => {
    // Razorpay keeps the window open after a failed attempt so the user can retry; settle only on
    // success (handler) or when the window closes — rejecting on the first failure would drop a later success.
    let lastFailure: string | null = null;
    const checkout = new Razorpay({
      key: order.publicKey,
      order_id: order.orderId,
      amount: order.amountMinor,
      currency: order.currency,
      name: 'ShowTime',
      description: `Booking ${order.bookingRef}`,
      prefill,
      handler: (response: RazorpayResponse) =>
        resolve({ orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }),
      modal: {
        escape: true,
        ondismiss: () => (lastFailure ? reject(new Error(`${lastFailure} You were not charged.`)) : resolve(null)),
      },
    });
    checkout.on('payment.failed', (response) => {
      lastFailure = response.error?.description ?? 'Payment failed.';
    });
    checkout.open();
  });
}
