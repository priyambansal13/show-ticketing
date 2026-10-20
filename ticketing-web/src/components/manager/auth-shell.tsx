import type { ReactNode } from 'react';
import { Brand } from '@/components/layout/brand';

/** Minimal chrome for the organizer sign-in, sign-up and approval pages. */
export function ManagerAuthShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-7xl items-center px-4">
          <Brand href="/manager/login" suffix="Organizer" />
        </div>
      </header>
      <main id="main" className="bg-muted/40 flex-1">
        {children}
      </main>
    </>
  );
}
