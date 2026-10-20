'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarPlus, Plus, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Notice } from '@/components/ui/feedback';
import { Field, FormError } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/errors';
import { useCreateEvent, useManagerEvent, useManagerEvents, usePublishEvent, useUpdateEvent } from '@/lib/api/hooks/manager';
import type { EventInput, ManagerEvent } from '@/lib/api/types';
import { formatDuration, titleCase } from '@/lib/format';
import { EVENT_CATEGORIES, eventSchema, splitList, type EventValues } from '@/lib/validation/manager';
import { LoadingRows, PageHeader, Pagination, QueryError, TableWrap, tdClass, thClass } from './page-parts';
import { applyServerErrors } from './venues';

const PAGE_SIZE = 20;

export function EventList() {
  const [page, setPage] = useState(1);
  const events = useManagerEvents(page, PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Events"
        description="Movies, concerts, plays and more. Publish an event to make its shows visible to customers."
        actions={
          <Button asChild>
            <Link href="/manager/events/new">
              <Plus aria-hidden />
              New event
            </Link>
          </Button>
        }
      />
      {events.isLoading ? (
        <LoadingRows label="Loading events" />
      ) : events.isError ? (
        <QueryError error={events.error} onRetry={() => void events.refetch()} title="Could not load events" />
      ) : !events.data || events.data.data.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Create an event, then schedule shows for it."
          action={
            <Button asChild size="sm">
              <Link href="/manager/events/new">Create an event</Link>
            </Button>
          }
        />
      ) : (
        <>
          <TableWrap>
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Your events</caption>
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th scope="col" className={thClass}>
                    Title
                  </th>
                  <th scope="col" className={thClass}>
                    Category
                  </th>
                  <th scope="col" className={thClass}>
                    Duration
                  </th>
                  <th scope="col" className={thClass}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {events.data.data.map((event) => (
                  <tr key={event.id}>
                    <td className={tdClass}>
                      <Link href={`/manager/events/${event.id}`} className="font-medium hover:underline">
                        {event.title}
                      </Link>
                      {event.language ? <div className="text-muted-foreground text-xs">{event.language}</div> : null}
                    </td>
                    <td className={tdClass}>{titleCase(event.category)}</td>
                    <td className={tdClass}>{formatDuration(event.durationMins)}</td>
                    <td className={tdClass}>
                      <StatusBadge status={event.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <Pagination page={page} limit={PAGE_SIZE} total={events.data.meta.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

const emptyEvent: EventValues = {
  title: '',
  description: '',
  category: 'MOVIE',
  language: '',
  genres: '',
  durationMins: '',
  posterUrl: '',
  bannerUrl: '',
  ageRating: '',
  cast: [],
};

function toValues(event: ManagerEvent): EventValues {
  return {
    title: event.title,
    description: event.description,
    category: event.category,
    language: event.language ?? '',
    genres: event.genres.join(', '),
    durationMins: String(event.durationMins),
    posterUrl: event.posterUrl ?? '',
    bannerUrl: event.bannerUrl ?? '',
    ageRating: event.ageRating ?? '',
    cast: event.cast.map((member) => ({ name: member.name, role: member.role ?? '' })),
  };
}

/** Form values → API body; empty optional strings are omitted (the API rejects "" for URLs). */
function toBody(raw: EventValues): EventInput {
  const values = eventSchema.parse(raw);
  return {
    title: values.title,
    description: values.description,
    category: values.category,
    durationMins: Number(values.durationMins),
    genres: splitList(values.genres),
    cast: values.cast.map((member) => ({ name: member.name, ...(member.role ? { role: member.role } : {}) })),
    ...(values.language ? { language: values.language } : {}),
    ...(values.posterUrl ? { posterUrl: values.posterUrl } : {}),
    ...(values.bannerUrl ? { bannerUrl: values.bannerUrl } : {}),
    ...(values.ageRating ? { ageRating: values.ageRating } : {}),
  };
}

function EventForm({
  initial,
  submitLabel,
  onSubmit,
  disabled,
}: {
  initial: EventValues;
  submitLabel: string;
  onSubmit: (body: EventInput) => Promise<EventValues | void>;
  disabled?: boolean;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<EventValues>({ resolver: zodResolver(eventSchema), defaultValues: initial });
  const cast = useFieldArray({ control: form.control, name: 'cast' });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      const next = await onSubmit(toBody(values));
      if (next) {
        form.reset(next);
        setSaved(true);
      }
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-6">
      <FormError message={formError} />
      <div aria-live="polite">{saved ? <Notice tone="success">Event saved.</Notice> : null}</div>
      <fieldset disabled={disabled} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>About the event</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" error={errors.title?.message} className="sm:col-span-2">
              <Input {...form.register('title')} />
            </Field>
            <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
              <Textarea rows={5} {...form.register('description')} />
            </Field>
            <Field label="Category" error={errors.category?.message}>
              <Select {...form.register('category')}>
                {EVENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {titleCase(category)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Duration (minutes)" error={errors.durationMins?.message}>
              <Input type="number" inputMode="numeric" min={1} max={1440} {...form.register('durationMins')} />
            </Field>
            <Field label="Language" optional error={errors.language?.message}>
              <Input {...form.register('language')} />
            </Field>
            <Field label="Age rating" optional hint="e.g. U, UA, A, 13+" error={errors.ageRating?.message}>
              <Input maxLength={8} {...form.register('ageRating')} />
            </Field>
            <Field label="Genres" optional hint="Comma separated, up to 10" error={errors.genres?.message} className="sm:col-span-2">
              <Input {...form.register('genres')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Images</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Poster URL" optional hint="https:// only. Portrait image." error={errors.posterUrl?.message}>
              <Input type="url" inputMode="url" {...form.register('posterUrl')} />
            </Field>
            <Field label="Banner URL" optional hint="https:// only. Wide image." error={errors.bannerUrl?.message}>
              <Input type="url" inputMode="url" {...form.register('bannerUrl')} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cast & crew</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {cast.fields.length === 0 ? <p className="text-muted-foreground text-sm">Optional.</p> : null}
            {cast.fields.map((field, index) => (
              <fieldset key={field.id} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]">
                <legend className="sr-only">Cast member {index + 1}</legend>
                <Field label="Name" error={errors.cast?.[index]?.name?.message}>
                  <Input {...form.register(`cast.${index}.name`)} />
                </Field>
                <Field label="Role" optional error={errors.cast?.[index]?.role?.message}>
                  <Input {...form.register(`cast.${index}.role`)} />
                </Field>
                <Button variant="ghost" size="icon" aria-label={`Remove cast member ${index + 1}`} onClick={() => cast.remove(index)}>
                  <Trash2 aria-hidden />
                </Button>
              </fieldset>
            ))}
            <Button
              variant="outline"
              className="w-fit"
              disabled={cast.fields.length >= 50}
              onClick={() => cast.append({ name: '', role: '' })}
            >
              <Plus aria-hidden />
              Add person
            </Button>
          </CardContent>
        </Card>
      </fieldset>
      {disabled ? null : (
        <Button type="submit" className="w-fit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      )}
    </form>
  );
}

export function NewEvent() {
  const router = useRouter();
  const create = useCreateEvent();
  return (
    <>
      <PageHeader
        title="New event"
        description="Events start as drafts. Publish when you are ready."
        back={{ href: '/manager/events', label: 'Events' }}
      />
      <EventForm
        initial={emptyEvent}
        submitLabel="Create draft"
        onSubmit={async (body) => {
          const event = await create.mutateAsync(body);
          router.push(`/manager/events/${event.id}`);
        }}
      />
    </>
  );
}

export function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const event = useManagerEvent(id);
  const update = useUpdateEvent(id);
  const publish = usePublishEvent(id);
  const [publishError, setPublishError] = useState<string | null>(null);

  if (event.isLoading) return <LoadingRows label="Loading event" />;
  if (event.isError || !event.data)
    return <QueryError error={event.error} onRetry={() => void event.refetch()} title="Could not load this event" />;

  const data = event.data;
  return (
    <>
      <PageHeader
        title={data.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} /> {titleCase(data.category)} · {formatDuration(data.durationMins)} · /{data.slug}
          </span>
        }
        back={{ href: '/manager/events', label: 'Events' }}
        actions={
          <>
            {data.status === 'DRAFT' ? (
              <Button
                loading={publish.isPending}
                onClick={async () => {
                  setPublishError(null);
                  try {
                    await publish.mutateAsync();
                  } catch (error) {
                    setPublishError(errorMessage(error));
                  }
                }}
              >
                <Send aria-hidden />
                Publish
              </Button>
            ) : null}
            {data.status === 'PUBLISHED' ? (
              <Button asChild variant="outline">
                <Link href={`/manager/shows/new?eventId=${data.id}`}>
                  <CalendarPlus aria-hidden />
                  Schedule a show
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-6 flex flex-col gap-3" aria-live="polite">
        <FormError message={publishError} />
        {data.status === 'DRAFT' ? (
          <Notice>This event is a draft. Customers cannot see it or its shows until you publish it.</Notice>
        ) : null}
        {data.status === 'CANCELLED' ? <Notice tone="warning">This event is cancelled and can no longer be edited.</Notice> : null}
      </div>
      <EventForm
        key={data.id}
        initial={toValues(data)}
        submitLabel="Save changes"
        disabled={data.status === 'CANCELLED'}
        onSubmit={async (body) => toValues(await update.mutateAsync(body))}
      />
    </>
  );
}
