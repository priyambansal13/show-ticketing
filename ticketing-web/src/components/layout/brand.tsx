import { Ticket } from 'lucide-react';
import Link from 'next/link';

export function Brand({ href = '/', suffix }: { href?: string; suffix?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-lg font-bold tracking-tight">
      <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
        <Ticket aria-hidden className="size-5" />
      </span>
      <span>ShowTime{suffix ? <span className="text-muted-foreground ml-1.5 text-sm font-medium">{suffix}</span> : null}</span>
    </Link>
  );
}
