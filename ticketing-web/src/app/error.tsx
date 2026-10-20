'use client';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/feedback';

export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-16">
      <ErrorState
        title="Something went wrong"
        message="An unexpected error occurred. Please try again."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </main>
  );
}
