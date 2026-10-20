import { Search } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { Brand } from '@/components/layout/brand';
import { CustomerAccountMenu } from '@/components/layout/customer-account-menu';
import { Skeleton } from '@/components/ui/feedback';

export default function CustomerLayout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <header className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          <Brand />
          <nav aria-label="Main" className="ml-auto flex items-center gap-1 sm:gap-3">
            <Link href="/events" className="hover:bg-muted flex items-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium">
              <Search aria-hidden className="size-4" />
              <span className="hidden sm:inline">Browse events</span>
              <span className="sm:hidden">Browse</span>
            </Link>
            {/* Reads the URL and session, so it streams in after the prerendered shell. */}
            <Suspense fallback={<Skeleton className="h-9 w-24" />}>
              <CustomerAccountMenu />
            </Suspense>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="text-muted-foreground border-t py-8 text-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 sm:flex-row sm:justify-between">
          <p>ShowTime — a learning project modelled on BookMyShow.</p>
          <p>
            Hosting events?{' '}
            <Link href="/manager/login" className="text-foreground font-medium underline underline-offset-4">
              Organizer portal
            </Link>
          </p>
        </div>
      </footer>
    </>
  );
}
