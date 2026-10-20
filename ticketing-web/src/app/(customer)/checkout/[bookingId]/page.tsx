import type { Metadata } from 'next';
import { RequireSession } from '@/components/auth/require-session';
import { CheckoutRoute } from '@/components/checkout/checkout';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

export default function CheckoutPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Checkout</h1>
      <RequireSession portal="customer">
        <CheckoutRoute />
      </RequireSession>
    </div>
  );
}
