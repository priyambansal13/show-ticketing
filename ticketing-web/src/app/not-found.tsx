import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-20 text-center">
      <p className="text-primary text-sm font-semibold">404</p>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground">The page you are looking for does not exist or has moved.</p>
      <Button asChild className="mt-2">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
