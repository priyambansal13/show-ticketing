import { MapPin } from 'lucide-react';
import Link from 'next/link';
import type { EventShow } from '@/lib/api/types';
import { cityLabel, formatDate, formatDateTime, formatMoney, formatTime, toIsoDay } from '@/lib/format';

interface VenueGroup {
  key: string;
  name: string;
  hallName: string;
  city: string;
  shows: EventShow[];
}

/** Shows grouped by IST day, then by venue+hall, in start order. */
export function groupShows(shows: EventShow[]): { day: string; label: string; venues: VenueGroup[] }[] {
  const days = new Map<string, Map<string, VenueGroup>>();
  for (const show of [...shows].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const day = toIsoDay(show.startsAt);
    const venues = days.get(day) ?? new Map<string, VenueGroup>();
    days.set(day, venues);
    const key = `${show.venueId}:${show.hallId}`;
    const group = venues.get(key) ?? {
      key,
      name: show.venue?.name ?? 'Venue',
      hallName: show.venue?.hallName ?? show.hallId,
      city: show.city,
      shows: [],
    };
    group.shows.push(show);
    venues.set(key, group);
  }
  return [...days.entries()].map(([day, venues]) => ({ day, label: formatDate(`${day}T12:00:00+05:30`), venues: [...venues.values()] }));
}

const lowestPrice = (show: EventShow) => {
  const prices = Object.values(show.pricing);
  return prices.length ? prices.reduce((min, price) => (Number(price) < Number(min) ? price : min)) : null;
};

export function Showtimes({ shows, now }: { shows: EventShow[]; now: number }) {
  return (
    <div className="flex flex-col gap-8">
      {groupShows(shows).map(({ day, label, venues }) => (
        <section key={day} aria-labelledby={`day-${day}`} className="flex flex-col gap-4">
          <h3 id={`day-${day}`} className="text-lg font-semibold">
            {label}
          </h3>
          <ul className="flex flex-col gap-3">
            {venues.map((venue) => (
              <li key={venue.key} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{venue.name}</p>
                  <p className="text-muted-foreground flex items-center gap-1 text-sm">
                    <MapPin aria-hidden className="size-3.5" />
                    {venue.hallName} · {cityLabel(venue.city)}
                  </p>
                </div>
                <ul className="flex flex-wrap gap-2" aria-label={`Showtimes at ${venue.name}`}>
                  {venue.shows.map((show) => {
                    const salesOpen = show.status === 'ON_SALE' && Date.parse(show.salesOpenAt) <= now && Date.parse(show.startsAt) > now;
                    const from = lowestPrice(show);
                    return (
                      <li key={show.id}>
                        {salesOpen ? (
                          <Link
                            href={`/shows/${show.id}/seats`}
                            className="border-success/60 text-success hover:bg-success/10 flex flex-col items-center rounded-md border px-3 py-1.5 text-sm font-medium"
                          >
                            {formatTime(show.startsAt)}
                            {from ? (
                              <span className="text-muted-foreground text-[11px] font-normal">from {formatMoney(from, show.currency)}</span>
                            ) : null}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground flex flex-col items-center rounded-md border border-dashed px-3 py-1.5 text-sm">
                            {formatTime(show.startsAt)}
                            <span className="text-[11px]">
                              {show.status === 'ON_SALE' || show.status === 'SCHEDULED'
                                ? `Opens ${formatDateTime(show.salesOpenAt)}`
                                : 'Not available'}
                            </span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
