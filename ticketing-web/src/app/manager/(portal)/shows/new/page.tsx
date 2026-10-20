import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingRows } from '@/components/manager/page-parts';
import { NewShow } from '@/components/manager/shows';

export const metadata: Metadata = { title: 'New show' };

export default function Page() {
  return (
    <Suspense fallback={<LoadingRows label="Loading" />}>
      <NewShow />
    </Suspense>
  );
}
