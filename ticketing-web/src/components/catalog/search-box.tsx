import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Plain GET form — works before hydration and without JavaScript. */
export function SearchBox({ defaultValue, autoFocus }: { defaultValue?: string; autoFocus?: boolean }) {
  return (
    <form action="/events" role="search" className="flex w-full max-w-xl gap-2">
      <label htmlFor="q" className="sr-only">
        Search events
      </label>
      <Input
        id="q"
        name="q"
        type="search"
        minLength={2}
        maxLength={100}
        placeholder="Search movies, concerts, plays…"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        className="bg-background h-11"
      />
      <Button type="submit" size="lg" className="h-11">
        <Search aria-hidden />
        <span className="sr-only sm:not-sr-only">Search</span>
      </Button>
    </form>
  );
}
