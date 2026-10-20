import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

export function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-10 sm:py-16">
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
