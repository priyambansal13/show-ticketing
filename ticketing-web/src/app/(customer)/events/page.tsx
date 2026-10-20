import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CATEGORIES, EventGrid } from '@/components/catalog/event-card';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Input, Label, Select } from '@/components/ui/input';
import { browseEvents, getCities } from '@/lib/api/catalog.server';
import { cityLabel, titleCase } from '@/lib/format';
import { PAGE_SIZE, parseBrowseParams } from '@/lib/validation/browse';

export const metadata: Metadata = {
  title: 'Browse events',
  description: 'Find movies, concerts, plays, comedy and sports by city, date and category.',
};

export default function EventsPage({ searchParams }: PageProps<'/events'>) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">Browse events</h1>
      <Suspense fallback={<ResultsSkeleton />}>
        <FilteredResults searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function FilteredResults({ searchParams }: { searchParams: PageProps<'/events'>['searchParams'] }) {
  const query = parseBrowseParams(await searchParams);
  const [cities, result] = await Promise.all([getCities(), browseEvents(query)]);
  const activeFilters = [
    query.q && `“${query.q}”`,
    query.city && cityLabel(query.city),
    query.category && titleCase(query.category),
    query.date,
  ].filter(Boolean);

  return (
    <>
      <form
        action="/events"
        role="search"
        aria-label="Filter events"
        className="grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-5 sm:items-end"
      >
        <div className="col-span-2 flex flex-col gap-1.5">
          <Label htmlFor="filter-q">Search</Label>
          <Input id="filter-q" name="q" type="search" minLength={2} maxLength={100} defaultValue={query.q} placeholder="Title or keyword" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-city">City</Label>
          <Select id="filter-city" name="city" defaultValue={query.city ?? ''}>
            <option value="">All cities</option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {cityLabel(city)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-category">Category</Label>
          <Select id="filter-category" name="category" defaultValue={query.category ?? ''}>
            <option value="">All</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {titleCase(category)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-date">Date</Label>
          <Input id="filter-date" name="date" type="date" defaultValue={query.date} />
        </div>
        <div className="col-span-2 flex gap-2 sm:col-span-5 sm:justify-end">
          <Button variant="ghost" asChild>
            <Link href="/events">Clear</Link>
          </Button>
          <Button type="submit">Apply filters</Button>
        </div>
      </form>

      {!result.ok ? (
        <ErrorState title="Could not load events" message="The catalog is unavailable right now. Please try again shortly." />
      ) : (
        <section aria-labelledby="results-heading" className="flex flex-col gap-6">
          <h2 id="results-heading" aria-live="polite" className="text-muted-foreground text-sm">
            {result.data.meta.total} {result.data.meta.total === 1 ? 'event' : 'events'}
            {activeFilters.length ? ` for ${activeFilters.join(' · ')}` : ''}
          </h2>
          {result.data.data.length === 0 ? (
            <EmptyState
              title="No events match these filters"
              description="Try another date, city or category."
              action={
                <Link href="/events" className="text-primary text-sm font-medium hover:underline">
                  Clear filters
                </Link>
              }
            />
          ) : (
            <EventGrid events={result.data.data} priorityCount={5} />
          )}
          <Pagination query={query} total={result.data.meta.total} />
        </section>
      )}
    </>
  );
}

function Pagination({ query, total }: { query: ReturnType<typeof parseBrowseParams>; total: number }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  const href = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (key !== 'limit' && key !== 'page' && value !== undefined) params.set(key, String(value));
    params.set('page', String(page));
    return `/events?${params.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-3 text-sm">
      {query.page > 1 ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={href(query.page - 1)}>Previous</Link>
        </Button>
      ) : null}
      <span>
        Page {query.page} of {pages}
      </span>
      {query.page < pages ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={href(query.page + 1)}>Next</Link>
        </Button>
      ) : null}
    </nav>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading events">
      <Skeleton className="h-32 w-full" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="aspect-[2/3]" />
        ))}
      </div>
    </div>
  );
}
