'use client';

import { DropdownMenu } from 'radix-ui';
import { ChevronDown, LogOut, Ticket, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/feedback';
import { useSession } from '@/lib/auth/use-session';

export function CustomerAccountMenu() {
  const { status, user, session } = useSession('customer');
  const pathname = usePathname();

  if (status === 'unknown') return <Skeleton className="h-9 w-24" />;
  if (status === 'anonymous' || !user) {
    return (
      <Button asChild size="sm">
        <Link href={`/login?next=${encodeURIComponent(pathname)}`}>Sign in</Link>
      </Button>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="outline" size="sm" aria-label={`Account menu for ${user.name}`}>
          <UserRound aria-hidden />
          <span className="max-w-28 truncate">{user.name.split(' ')[0]}</span>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="bg-card z-50 min-w-48 rounded-md border p-1 shadow-md">
          <DropdownMenu.Label className="text-muted-foreground px-2 py-1.5 text-xs">{user.email}</DropdownMenu.Label>
          <DropdownMenu.Item
            asChild
            className="data-highlighted:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none"
          >
            <Link href="/bookings">
              <Ticket aria-hidden className="size-4" /> My bookings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="bg-border my-1 h-px" />
          <DropdownMenu.Item
            className="data-highlighted:bg-muted flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none"
            onSelect={async () => {
              await session.signOut('/');
            }}
          >
            <LogOut aria-hidden className="size-4" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
