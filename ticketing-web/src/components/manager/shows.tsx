'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Ban, Plus, Send, Users } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Notice } from '@/components/ui/feedback';
import { Field, FormError } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/errors';
import {
  useCancelShow,
  useCreateShow,
  useLayout,
  useManagerEvents,
  useManagerShow,
  useManagerShows,
  usePublishShow,
  useUpdateShow,
  useVenues,
} from '@/lib/api/hooks/manager';
import type { ManagerShow, ShowStatus } from '@/lib/api/types';
import { cityLabel, formatDateTime, formatMoney, moneyToInput } from '@/lib/format';
import { pricingToPaise, showCreateSchema, showTimesSchema, type ShowCreateValues, type ShowTimesValues } from '@/lib/validation/manager';
import { isoToIstLocal, istLocalToIso } from './datetime';
import { priceTiersOf } from './layout-generator';
import { DefinitionList, LoadingRows, PageHeader, Pagination, QueryError, TableWrap, tdClass, thClass } from './page-parts';
import { SeatBlocker } from './seat-blocker';
import { applyServerErrors } from './venues';

const PAGE_SIZE = 20;
const SHOW_STATUSES: ShowStatus[] = ['SCHEDULED', 'ON_SALE', 'CANCELLED', 'COMPLETED'];

/** Event titles and venue/hall names for id → label lookups (managers have few of each). */
function useCatalogNames() {
  const events = useManagerEvents(1, 100);
  const venues = useVenues(1, 100);
  return useMemo(() => {
    const eventTitle = new Map((events.data?.data ?? []).map((event) => [event.id, event.title]));
    const venueById = new Map((venues.data?.data ?? []).map((venue) => [venue.id, venue]));
    return {
      events,
      venues,
      eventTitle: (id: string) => eventTitle.get(id) ?? 'Event',
      place: (venueId: string, hallId: string) => {
        const venue = venueById.get(venueId);
        const hall = venue?.halls.find((item) => item.hallId === hallId);
        return venue ? `${venue.name} · ${hall?.name ?? hallId}` : hallId;
      },
    };
  }, [events, venues]);
}

export function ShowList() {
  const [page, setPage] = useState(1);
  const [eventId, setEventId] = useState('');
  const [status, setStatus] = useState<ShowStatus | ''>('');
  const names = useCatalogNames();
  const shows = useManagerShows({ page, limit: PAGE_SIZE, ...(eventId ? { eventId } : {}), ...(status ? { status } : {}) });

  return (
    <>
      <PageHeader
        title="Shows"
        description="Scheduled performances. Publishing a show puts its seats on sale."
        actions={
          <Button asChild>
            <Link href="/manager/shows/new">
              <Plus aria-hidden />
              New show
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3" role="search" aria-label="Filter shows">
        <Field label="Event" className="w-full sm:w-64">
          <Select
            value={eventId}
            onChange={(event) => {
              setEventId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All events</option>
            {(names.events.data?.data ?? []).map((event) => (
              <option key={event.id} value={event.id}>
                {event.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" className="w-full sm:w-48">
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ShowStatus | '');
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {SHOW_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.charAt(0) + value.slice(1).toLowerCase().replace('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {shows.isLoading ? (
        <LoadingRows label="Loading shows" />
      ) : shows.isError ? (
        <QueryError error={shows.error} onRetry={() => void shows.refetch()} title="Could not load shows" />
      ) : !shows.data || shows.data.data.length === 0 ? (
        <EmptyState
          title={eventId || status ? 'No shows match these filters' : 'No shows yet'}
          description="Schedule a show for one of your events in a hall with a seat layout."
          action={
            <Button asChild size="sm">
              <Link href="/manager/shows/new">Schedule a show</Link>
            </Button>
          }
        />
      ) : (
        <>
          <TableWrap>
            <table className="w-full min-w-[44rem] text-sm">
              <caption className="sr-only">Your shows</caption>
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th scope="col" className={thClass}>
                    Event
                  </th>
                  <th scope="col" className={thClass}>
                    Starts (IST)
                  </th>
                  <th scope="col" className={thClass}>
                    Venue
                  </th>
                  <th scope="col" className={thClass}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shows.data.data.map((show) => (
                  <tr key={show.id}>
                    <td className={tdClass}>
                      <Link href={`/manager/shows/${show.id}`} className="font-medium hover:underline">
                        {names.eventTitle(show.eventId)}
                      </Link>
                    </td>
                    <td className={tdClass}>{formatDateTime(show.startsAt)}</td>
                    <td className={tdClass}>
                      {names.place(show.venueId, show.hallId)}
                      <div className="text-muted-foreground text-xs">{cityLabel(show.city)}</div>
                    </td>
                    <td className={tdClass}>
                      <StatusBadge status={show.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <Pagination page={page} limit={PAGE_SIZE} total={shows.data.meta.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

export function NewShow() {
  const router = useRouter();
  const params = useSearchParams();
  const create = useCreateShow();
  const names = useCatalogNames();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ShowCreateValues>({
    resolver: zodResolver(showCreateSchema),
    defaultValues: {
      eventId: params.get('eventId') ?? '',
      venueId: '',
      hallId: '',
      startsAt: '',
      endsAt: '',
      salesOpenAt: '',
      pricing: {},
    },
  });
  const [venueId, hallId, eventId] = useWatch({ control: form.control, name: ['venueId', 'hallId', 'eventId'] });
  const venue = names.venues.data?.data.find((item) => item.id === venueId);
  const halls = (venue?.halls ?? []).filter((hall) => hall.layoutId);
  const layout = useLayout(venueId, hallId, Boolean(venueId && hallId));
  const tiers = layout.data ? priceTiersOf(layout.data) : [];
  const selectedEvent = names.events.data?.data.find((event) => event.id === eventId);
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const pricing = pricingToPaise(Object.fromEntries(tiers.map((tier) => [tier, values.pricing[tier] ?? ''])));
    if (tiers.length === 0 || Object.keys(pricing).length !== tiers.length) {
      setFormError('Enter a price for every price tier of this hall.');
      return;
    }
    try {
      const show = await create.mutateAsync({
        eventId: values.eventId,
        venueId: values.venueId,
        hallId: values.hallId,
        startsAt: istLocalToIso(values.startsAt),
        endsAt: istLocalToIso(values.endsAt),
        ...(values.salesOpenAt ? { salesOpenAt: istLocalToIso(values.salesOpenAt) } : {}),
        pricing,
        currency: 'INR',
      });
      router.push(`/manager/shows/${show.id}`);
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError));
    }
  });

  if (names.events.isLoading || names.venues.isLoading) return <LoadingRows label="Loading events and venues" />;
  if (names.events.isError) return <QueryError error={names.events.error} onRetry={() => void names.events.refetch()} />;
  if (names.venues.isError) return <QueryError error={names.venues.error} onRetry={() => void names.venues.refetch()} />;

  const events = (names.events.data?.data ?? []).filter((event) => event.status !== 'CANCELLED');
  const venues = (names.venues.data?.data ?? []).filter((item) => item.status === 'ACTIVE');

  return (
    <>
      <PageHeader
        title="New show"
        description="Times are in IST. Seats go on sale when you publish the show."
        back={{ href: '/manager/shows', label: 'Shows' }}
      />
      {events.length === 0 || venues.length === 0 ? (
        <EmptyState
          title={events.length === 0 ? 'Create an event first' : 'Add an active venue first'}
          description="A show needs an event and a venue hall with a seat layout."
          action={
            <Button asChild size="sm">
              <Link href={events.length === 0 ? '/manager/events/new' : '/manager/venues/new'}>
                {events.length === 0 ? 'New event' : 'New venue'}
              </Link>
            </Button>
          }
        />
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex max-w-3xl flex-col gap-6">
          <FormError message={formError} />
          <Card>
            <CardHeader>
              <CardTitle>What and where</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Event"
                error={errors.eventId?.message}
                hint={
                  selectedEvent?.status === 'DRAFT'
                    ? 'This event is a draft — customers will not see the show until the event is published.'
                    : undefined
                }
                className="sm:col-span-2"
              >
                <Select {...form.register('eventId')}>
                  <option value="">Choose an event</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title}
                      {event.status === 'DRAFT' ? ' (draft)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Venue" error={errors.venueId?.message}>
                <Select
                  {...form.register('venueId', {
                    onChange: () => {
                      form.setValue('hallId', '');
                      form.setValue('pricing', {});
                    },
                  })}
                >
                  <option value="">Choose a venue</option>
                  {venues.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({cityLabel(item.city)})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Hall"
                error={errors.hallId?.message}
                hint={
                  venue && halls.length === 0 ? 'No hall of this venue has a seat layout yet.' : 'Only halls with a seat layout are listed.'
                }
              >
                <Select {...form.register('hallId', { onChange: () => form.setValue('pricing', {}) })} disabled={!venue}>
                  <option value="">Choose a hall</option>
                  {halls.map((hall) => (
                    <option key={hall.hallId} value={hall.hallId}>
                      {hall.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>When (IST)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts at" error={errors.startsAt?.message}>
                <Input type="datetime-local" {...form.register('startsAt')} />
              </Field>
              <Field label="Ends at" error={errors.endsAt?.message}>
                <Input type="datetime-local" {...form.register('endsAt')} />
              </Field>
              <Field label="Sales open at" optional hint="Defaults to when you publish." error={errors.salesOpenAt?.message}>
                <Input type="datetime-local" {...form.register('salesOpenAt')} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pricing (₹)</CardTitle>
              <CardDescription>One price per tier defined in the hall’s seat layout.</CardDescription>
            </CardHeader>
            <CardContent>
              {!hallId ? (
                <p className="text-muted-foreground text-sm">Choose a hall to see its price tiers.</p>
              ) : layout.isLoading ? (
                <LoadingRows rows={2} label="Loading price tiers" />
              ) : layout.isError ? (
                <QueryError error={layout.error} onRetry={() => void layout.refetch()} />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {tiers.map((tier) => (
                    <Field key={`${hallId}-${tier}`} label={tier} error={errors.pricing?.[tier]?.message}>
                      <Input inputMode="decimal" placeholder="e.g. 250" {...form.register(`pricing.${tier}`)} />
                    </Field>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Button type="submit" className="w-fit" loading={isSubmitting}>
            Create show
          </Button>
        </form>
      )}
    </>
  );
}

export function ShowDetail() {
  const { id } = useParams<{ id: string }>();
  const show = useManagerShow(id);
  const names = useCatalogNames();
  const publish = usePublishShow(id);
  const cancel = useCancelShow(id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (show.isLoading) return <LoadingRows label="Loading show" />;
  if (show.isError || !show.data)
    return <QueryError error={show.error} onRetry={() => void show.refetch()} title="Could not load this show" />;
  const data = show.data;
  const title = names.eventTitle(data.eventId);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setActionError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={data.status} /> {formatDateTime(data.startsAt)} · {names.place(data.venueId, data.hallId)}
          </span>
        }
        back={{ href: '/manager/shows', label: 'Shows' }}
        actions={
          <>
            {data.status === 'SCHEDULED' ? (
              <Button
                loading={publish.isPending}
                onClick={() => run(() => publish.mutateAsync(undefined), 'Show published — seats are on sale.')}
              >
                <Send aria-hidden />
                Publish
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={`/manager/shows/${data.id}/bookings`}>
                <Users aria-hidden />
                Bookings
              </Link>
            </Button>
            {data.status === 'SCHEDULED' || data.status === 'ON_SALE' ? (
              <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                <Ban aria-hidden />
                Cancel show
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-6 flex flex-col gap-3" aria-live="polite">
        <FormError message={actionError} />
        {notice ? <Notice tone="success">{notice}</Notice> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DefinitionList
              items={[
                { term: 'Starts', value: formatDateTime(data.startsAt) },
                { term: 'Ends', value: formatDateTime(data.endsAt) },
                { term: 'Sales open', value: formatDateTime(data.salesOpenAt) },
                { term: 'City', value: cityLabel(data.city) },
                { term: 'Layout version', value: data.layoutVersion },
                { term: 'Currency', value: data.currency },
                ...Object.entries(data.pricing).map(([tier, price]) => ({
                  term: `Price · ${tier}`,
                  value: formatMoney(price, data.currency),
                })),
              ]}
            />
          </CardContent>
        </Card>
        {data.status === 'SCHEDULED' ? (
          <EditShowCard key={`${data.id}-${data.startsAt}-${JSON.stringify(data.pricing)}`} show={data} />
        ) : null}
        {data.status === 'ON_SALE' ? <SeatBlocker showId={data.id} /> : null}
      </div>

      <Dialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this show?"
        description="All confirmed bookings are refunded in full and customers are emailed. This cannot be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              Keep show
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={async () => {
                await run(() => cancel.mutateAsync(undefined), 'Cancelling — refunds and emails run in the background.');
                setConfirmCancel(false);
              }}
            >
              Cancel show
            </Button>
          </>
        }
      />
    </>
  );
}

function EditShowCard({ show }: { show: ManagerShow }) {
  const update = useUpdateShow(show.id);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const tiers = Object.keys(show.pricing);
  const form = useForm<ShowTimesValues>({
    resolver: zodResolver(showTimesSchema),
    defaultValues: {
      startsAt: isoToIstLocal(show.startsAt),
      endsAt: isoToIstLocal(show.endsAt),
      salesOpenAt: isoToIstLocal(show.salesOpenAt),
      pricing: Object.fromEntries(Object.entries(show.pricing).map(([tier, price]) => [tier, moneyToInput(price)])),
    },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      await update.mutateAsync({
        startsAt: istLocalToIso(values.startsAt),
        endsAt: istLocalToIso(values.endsAt),
        ...(values.salesOpenAt ? { salesOpenAt: istLocalToIso(values.salesOpenAt) } : {}),
        pricing: pricingToPaise(values.pricing),
      });
      setSaved(true);
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit times & pricing</CardTitle>
        <CardDescription>Editable until the show is published. Times are in IST.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError message={formError} />
          <div aria-live="polite">{saved ? <Notice tone="success">Show updated.</Notice> : null}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts at" error={errors.startsAt?.message}>
              <Input type="datetime-local" {...form.register('startsAt')} />
            </Field>
            <Field label="Ends at" error={errors.endsAt?.message}>
              <Input type="datetime-local" {...form.register('endsAt')} />
            </Field>
            <Field label="Sales open at" error={errors.salesOpenAt?.message}>
              <Input type="datetime-local" {...form.register('salesOpenAt')} />
            </Field>
          </div>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Prices (₹)</legend>
            {tiers.map((tier) => (
              <Field key={tier} label={tier} error={errors.pricing?.[tier]?.message}>
                <Input inputMode="decimal" {...form.register(`pricing.${tier}`)} />
              </Field>
            ))}
          </fieldset>
          <Button type="submit" className="w-fit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
