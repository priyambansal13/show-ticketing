import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { CatalogEvent } from '@/lib/api/types';
import { formatDuration, titleCase } from '@/lib/format';
import { Poster } from './poster';

export function EventCard({ event, priority }: { event: CatalogEvent; priority?: boolean }) {
  return (
    <Link href={`/events/${event.slug}`} className="group flex flex-col gap-2 rounded-lg focus-visible:outline-offset-4">
      <Poster url={event.posterUrl} title={event.title} priority={priority} className="transition-transform group-hover:scale-[1.02]" />
      <div className="flex flex-col gap-1">
        <h3 className="line-clamp-2 leading-snug font-semibold group-hover:underline">{event.title}</h3>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge>{titleCase(event.category)}</Badge>
          {event.language ? <span>{event.language}</span> : null}
          <span>{formatDuration(event.durationMins)}</span>
          {event.ageRating ? <span>{event.ageRating}</span> : null}
        </p>
      </div>
    </Link>
  );
}

export function EventGrid({ events, priorityCount = 0 }: { events: CatalogEvent[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {events.map((event, index) => (
        <li key={event.id}>
          <EventCard event={event} priority={index < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

export const CATEGORIES = ['MOVIE', 'CONCERT', 'PLAY', 'COMEDY', 'SPORTS'] as const;
