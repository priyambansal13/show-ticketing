import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Poster } from '@/components/catalog/poster';
import { Showtimes } from '@/components/catalog/showtimes';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { getEvent, getEventShows } from '@/lib/api/catalog.server';
import { formatDuration, titleCase } from '@/lib/format';

export async function generateMetadata({ params }: PageProps<'/events/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event.ok) return { title: 'Event' };
  return {
    title: event.data.title,
    description: event.data.description.slice(0, 160),
    openGraph: {
      title: event.data.title,
      description: event.data.description.slice(0, 160),
      images: event.data.posterUrl ? [event.data.posterUrl] : [],
    },
  };
}

export default function EventPage({ params }: PageProps<'/events/[slug]'>) {
  return (
    <Suspense fallback={<EventSkeleton />}>
      <EventDetail params={params} />
    </Suspense>
  );
}

async function EventDetail({ params }: { params: PageProps<'/events/[slug]'>['params'] }) {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event.ok) {
    if (event.status === 404 || event.status === 400) notFound();
    return (
      <div className="mx-auto max-w-7xl px-4 py-10">
        <ErrorState title="Could not load this event" message="Please try again in a moment." />
      </div>
    );
  }
  const { data } = event;

  return (
    <article>
      <header className="from-accent to-background border-b bg-gradient-to-b">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:grid-cols-[220px_1fr]">
          <Poster url={data.posterUrl} title={data.title} priority sizes="220px" className="w-40 sm:w-full" />
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{data.title}</h1>
            <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="primary">{titleCase(data.category)}</Badge>
              <span>{formatDuration(data.durationMins)}</span>
              {data.language ? <span>· {data.language}</span> : null}
              {data.ageRating ? <span>· {data.ageRating}</span> : null}
            </p>
            {data.genres.length ? <p className="text-sm">{data.genres.map((genre) => titleCase(genre)).join(', ')}</p> : null}
            <p className="max-w-3xl leading-relaxed whitespace-pre-line">{data.description}</p>
            {data.cast.length ? (
              <div>
                <h2 className="mb-1 text-sm font-semibold">Cast &amp; crew</h2>
                <p className="text-muted-foreground text-sm">
                  {data.cast.map((member) => (member.role ? `${member.name} (${member.role})` : member.name)).join(' · ')}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <section aria-labelledby="showtimes" className="mx-auto max-w-7xl px-4 py-8">
        <h2 id="showtimes" className="mb-4 text-xl font-semibold">
          Showtimes
        </h2>
        <Suspense fallback={<Skeleton className="h-40 w-full" />}>
          <EventShowtimes eventId={data.id} />
        </Suspense>
      </section>
    </article>
  );
}

async function EventShowtimes({ eventId }: { eventId: string }) {
  // Sale windows depend on the current time, so this part renders per request (streamed).
  await connection();
  const shows = await getEventShows(eventId);
  if (!shows.ok) return <ErrorState title="Could not load showtimes" message="Please refresh in a moment." />;
  const now = requestTime();
  const upcoming = shows.data.filter((show) => Date.parse(show.startsAt) > now);
  if (upcoming.length === 0)
    return <EmptyState title="No upcoming shows" description="New showtimes are added regularly — check back soon." />;
  return <Showtimes shows={upcoming} now={now} />;
}

function EventSkeleton() {
  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:grid-cols-[220px_1fr]" role="status" aria-label="Loading event">
      <Skeleton className="aspect-[2/3] w-40 sm:w-full" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

/** Server Components render once per request here (after `connection()`), so reading the clock is safe. */
function requestTime(): number {
  return Date.now();
}
