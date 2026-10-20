'use client';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/feedback';

export default function CustomerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16">
      <ErrorState
        title="Something went wrong"
        message="We could not show this page. Please try again."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
