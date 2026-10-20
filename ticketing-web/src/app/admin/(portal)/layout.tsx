'use client';

import { LogOut } from 'lucide-react';
import { RequireSession } from '@/components/auth/require-session';
import { Brand } from '@/components/layout/brand';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth/use-session';

export default function AdminPortalLayout({ children }: LayoutProps<'/admin'>) {
  const { user, session } = useSession('admin');
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Brand href="/admin/managers" suffix="Admin" />
          <div className="ml-auto flex items-center gap-3 text-sm">
            {user ? <span className="text-muted-foreground hidden sm:inline">{user.email}</span> : null}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await session.signOut('/admin/login');
              }}
            >
              <LogOut aria-hidden /> Sign out
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <RequireSession portal="admin">{children}</RequireSession>
      </main>
    </>
  );
}
