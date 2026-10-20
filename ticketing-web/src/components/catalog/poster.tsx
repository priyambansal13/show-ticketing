import Image from 'next/image';
import { IMAGE_HOSTS } from '@/lib/config';
import { cn } from '@/lib/utils';

function allowed(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && IMAGE_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

const GRADIENTS = [
  'from-rose-600 to-orange-500',
  'from-indigo-600 to-sky-500',
  'from-emerald-600 to-teal-500',
  'from-fuchsia-600 to-pink-500',
  'from-amber-600 to-red-500',
];

/** Poster with a fixed 2:3 box (no layout shift); hosts outside the allow-list get a typographic placeholder. */
export function Poster({
  url,
  title,
  priority,
  className,
  sizes,
}: {
  url: string | null;
  title: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  const gradient = GRADIENTS[[...title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % GRADIENTS.length];
  return (
    <div className={cn('bg-muted relative aspect-[2/3] overflow-hidden rounded-lg', className)}>
      {allowed(url) ? (
        <Image
          src={url}
          alt={`Poster for ${title}`}
          fill
          priority={priority}
          sizes={sizes ?? '(max-width: 640px) 50vw, 220px'}
          className="object-cover"
        />
      ) : (
        <div aria-hidden className={cn('flex h-full items-end bg-gradient-to-br p-3 text-white', gradient)}>
          <span className="line-clamp-3 text-lg leading-tight font-bold">{title}</span>
        </div>
      )}
    </div>
  );
}
