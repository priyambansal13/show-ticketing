import type { Metadata } from 'next';
import { LayoutBuilderPage } from '@/components/manager/layout-builder';

export const metadata: Metadata = { title: 'Seat layout' };

export default function HallLayoutPage() {
  return <LayoutBuilderPage />;
}
