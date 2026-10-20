import type { Metadata } from 'next';
import { ShowDetail } from '@/components/manager/shows';

export const metadata: Metadata = { title: 'Show' };

export default function Page() {
  return <ShowDetail />;
}
