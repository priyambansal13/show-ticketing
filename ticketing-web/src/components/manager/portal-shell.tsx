'use client';

import { BarChart3, Building2, CalendarClock, Clapperboard, LogOut, Menu, ScanLine, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { RequireSession } from '@/components/auth/require-session';
import { Brand } from '@/components/layout/brand';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth/use-session';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/manager/dashboard', label: 'Dashboard', icon: BarChart3 },
  { href: '/manager/venues', label: 'Venues', icon: Building2 },
  { href: '/manager/events', label: 'Events', icon: Clapperboard },
  { href: '/manager/shows', label: 'Shows', icon: CalendarClock },
  { href: '/manager/tickets', label: 'Ticket check-in', icon: ScanLine },
] as const;

export function ManagerPortalShell({ children }: { children: ReactNode }) {
  return (
    <RequireSession portal="manager" pendingPath="/manager/pending">
      <Shell>{children}</Shell>
    </RequireSession>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, session } = useSession('manager');
  // The mobile menu stays open only on the page it was opened on, so navigating closes it.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;

  const signOut = async () => {
    await session.signOut('/manager/login');
  };

  const nav = (
    <nav aria-label="Organizer" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'hover:bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium',
              active && 'bg-accent text-primary',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="manager-mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuPath(menuOpen ? null : pathname)}
          >
            {menuOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </Button>
          <Brand href="/manager/dashboard" suffix="Organizer" />
          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted-foreground hidden max-w-48 truncate text-sm sm:inline">{user?.name}</span>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut aria-hidden />
              Sign out
            </Button>
          </div>
        </div>
        {menuOpen ? (
          <div id="manager-mobile-nav" className="border-t px-4 py-3 lg:hidden">
            {nav}
          </div>
        ) : null}
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r p-4 lg:block">{nav}</aside>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
