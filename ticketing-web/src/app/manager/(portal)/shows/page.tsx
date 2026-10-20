import type { Metadata } from 'next';
import { ShowList } from '@/components/manager/shows';

export const metadata: Metadata = { title: 'Shows' };

export default function Page() {
  return <ShowList />;
}
