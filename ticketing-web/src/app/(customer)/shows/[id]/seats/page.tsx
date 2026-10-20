import { ArrowLeft, CalendarClock, MapPin } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { SeatPicker } from '@/components/seat-map/seat-picker';
import { ErrorState, Skeleton } from '@/components/ui/feedback';
import { getShow } from '@/lib/api/catalog.server';
import { cityLabel, formatDateTime } from '@/lib/format';

const SHOW_ID = /^[0-9a-f]{24}$/;

export async function generateMetadata({ params }: PageProps<'/shows/[id]/seats'>): Promise<Metadata> {
  const { id } = await params;
  const show = SHOW_ID.test(id) ? await getShow(id) : null;
  return { title: show?.ok ? `Select seats · ${show.data.event?.title ?? 'Show'}` : 'Select seats', robots: { index: false } };
}

export default function SeatsPage({ params }: PageProps<'/shows/[id]/seats'>) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ShowSeats params={params} />
      </Suspense>
    </div>
  );
}

async function ShowSeats({ params }: { params: PageProps<'/shows/[id]/seats'>['params'] }) {
  const { id } = await params;
  if (!SHOW_ID.test(id)) notFound();
  const show = await getShow(id);
  if (!show.ok) {
    if (show.status === 404) notFound();
    return <ErrorState title="Could not load this show" message="Please try again in a moment." />;
  }
  const { event, venue } = show.data;

  return (
    <>
      <header className="flex flex-col gap-1">
        {event ? (
          <Link
            href={`/events/${event.slug}`}
            className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-sm"
          >
            <ArrowLeft aria-hidden className="size-4" /> Back to {event.title}
          </Link>
        ) : null}
        <h1 className="text-2xl font-bold">{event?.title ?? 'Select your seats'}</h1>
        <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1">
            <CalendarClock aria-hidden className="size-4" />
            {formatDateTime(show.data.startsAt)}
          </span>
          {venue ? (
            <span className="flex items-center gap-1">
              <MapPin aria-hidden className="size-4" />
              {venue.name}, {venue.hallName} · {cityLabel(venue.city)}
            </span>
          ) : null}
        </p>
      </header>
      <SeatPicker showId={id} />
    </>
  );
}
