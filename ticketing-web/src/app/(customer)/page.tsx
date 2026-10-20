import { Clapperboard, Drama, Laugh, Music, Trophy } from 'lucide-react';
import Link from 'next/link';
import { CATEGORIES, EventGrid } from '@/components/catalog/event-card';
import { SearchBox } from '@/components/catalog/search-box';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { browseEvents, getCities } from '@/lib/api/catalog.server';
import { cityLabel, titleCase } from '@/lib/format';

const CATEGORY_ICON = { MOVIE: Clapperboard, CONCERT: Music, PLAY: Drama, COMEDY: Laugh, SPORTS: Trophy } as const;

export default async function HomePage() {
  const [cities, events] = await Promise.all([getCities(), browseEvents({ limit: 15 })]);

  return (
    <>
      <section className="from-accent to-background border-b bg-gradient-to-b">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-5 px-4 py-12 sm:py-16">
          <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">Your next night out starts here.</h1>
          <p className="text-muted-foreground max-w-xl">
            Movies, concerts, plays, comedy and sports — pick your seats live and book in seconds.
          </p>
          <SearchBox />
          {cities.length > 0 ? (
            <nav aria-label="Cities" className="flex flex-wrap gap-2">
              {cities.map((city) => (
                <Link
                  key={city}
                  href={`/events?city=${city}`}
                  className="bg-background hover:bg-muted rounded-full border px-3 py-1 text-sm"
                >
                  {cityLabel(city)}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </section>

      <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-10">
        <section aria-labelledby="categories">
          <h2 id="categories" className="mb-4 text-xl font-semibold">
            Browse by category
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {CATEGORIES.map((category) => {
              const Icon = CATEGORY_ICON[category];
              return (
                <li key={category}>
                  <Link
                    href={`/events?category=${category}`}
                    className="hover:bg-muted flex items-center gap-3 rounded-lg border p-4 font-medium"
                  >
                    <Icon aria-hidden className="text-primary size-5" />
                    {titleCase(category)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="now-showing">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="now-showing" className="text-xl font-semibold">
              Now booking
            </h2>
            <Link href="/events" className="text-primary text-sm font-medium hover:underline">
              See all
            </Link>
          </div>
          {!events.ok ? (
            <ErrorState title="Events are unavailable right now" message="We could not load the catalog. Please refresh in a moment." />
          ) : events.data.data.length === 0 ? (
            <EmptyState title="No events yet" description="Organizers have not published any events. Check back soon." />
          ) : (
            <EventGrid events={events.data.data} priorityCount={5} />
          )}
        </section>
      </div>
    </>
  );
}
