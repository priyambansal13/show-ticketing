'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LayoutGrid, MapPin, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, Notice } from '@/components/ui/feedback';
import { Field, FormError } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { errorMessage, fieldErrors } from '@/lib/api/errors';
import { useAddHall, useCreateVenue, useUpdateVenue, useVenue, useVenues } from '@/lib/api/hooks/manager';
import type { Venue } from '@/lib/api/types';
import { cityLabel } from '@/lib/format';
import {
  hallSchema,
  venueEditSchema,
  venueSchema,
  type HallValues,
  type VenueEditValues,
  type VenueValues,
} from '@/lib/validation/manager';
import { DefinitionList, LoadingRows, PageHeader, Pagination, QueryError } from './page-parts';

/** Copies API VALIDATION_FAILED issues onto form fields; returns the form-level message. */
export function applyServerErrors<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>): string {
  for (const [path, message] of Object.entries(fieldErrors(error))) setError(path as Path<T>, { message });
  return errorMessage(error);
}

const PAGE_SIZE = 20;

export function VenueList() {
  const [page, setPage] = useState(1);
  const venues = useVenues(page, PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Venues"
        description="Your venues and their halls. Each hall needs a seat layout before shows can be scheduled in it."
        actions={
          <Button asChild>
            <Link href="/manager/venues/new">
              <Plus aria-hidden />
              New venue
            </Link>
          </Button>
        }
      />
      {venues.isLoading ? (
        <LoadingRows label="Loading venues" />
      ) : venues.isError ? (
        <QueryError error={venues.error} onRetry={() => void venues.refetch()} title="Could not load venues" />
      ) : !venues.data || venues.data.data.length === 0 ? (
        <EmptyState
          title="No venues yet"
          description="Add your first venue, then its halls and seat layouts."
          action={
            <Button asChild size="sm">
              <Link href="/manager/venues/new">Add a venue</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {venues.data.data.map((venue) => (
              <li key={venue.id}>
                <Card className="h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        <Link href={`/manager/venues/${venue.id}`} className="hover:underline">
                          {venue.name}
                        </Link>
                      </CardTitle>
                      <StatusBadge status={venue.status} />
                    </div>
                    <CardDescription className="flex items-center gap-1">
                      <MapPin aria-hidden className="size-3.5" />
                      {cityLabel(venue.city)} · {venue.address.line1}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-muted-foreground text-sm">
                    {venue.halls.length === 0
                      ? 'No halls yet'
                      : `${venue.halls.length} hall${venue.halls.length === 1 ? '' : 's'} · ${venue.halls.filter((hall) => hall.layoutId).length} with a layout`}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination page={page} limit={PAGE_SIZE} total={venues.data.meta.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

const emptyVenue: VenueValues = { name: '', city: '', address: { line1: '', line2: '', state: '', postalCode: '' }, halls: [] };

export function NewVenue() {
  const router = useRouter();
  const create = useCreateVenue();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<VenueValues>({ resolver: zodResolver(venueSchema), defaultValues: emptyVenue });
  const halls = useFieldArray({ control: form.control, name: 'halls' });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (raw) => {
    setFormError(null);
    const values = venueSchema.parse(raw);
    try {
      const venue = await create.mutateAsync({
        name: values.name,
        city: values.city,
        address: { ...values.address, line2: values.address.line2 || undefined, country: 'IN' },
        halls: values.halls,
      });
      router.push(`/manager/venues/${venue.id}`);
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError));
    }
  });

  return (
    <>
      <PageHeader title="New venue" back={{ href: '/manager/venues', label: 'Venues' }} />
      <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-6">
        <FormError message={formError} />
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Venue name" error={errors.name?.message} className="sm:col-span-2">
              <Input autoComplete="organization" {...form.register('name')} />
            </Field>
            <Field
              label="City"
              hint='Lower-case slug, e.g. "bengaluru" or "new-delhi". Cannot be changed later.'
              error={errors.city?.message}
            >
              <Input autoCapitalize="none" {...form.register('city')} />
            </Field>
            <AddressFields register={form.register} errors={errors.address} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Halls</CardTitle>
            <CardDescription>Screens or auditoriums. You can add more later.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {halls.fields.map((field, index) => (
              <fieldset key={field.id} className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]">
                <legend className="sr-only">Hall {index + 1}</legend>
                <Field label="Hall id" hint='e.g. "audi-1"' error={errors.halls?.[index]?.hallId?.message}>
                  <Input autoCapitalize="none" {...form.register(`halls.${index}.hallId`)} />
                </Field>
                <Field label="Hall name" error={errors.halls?.[index]?.name?.message}>
                  <Input {...form.register(`halls.${index}.name`)} />
                </Field>
                <Button variant="ghost" size="icon" aria-label={`Remove hall ${index + 1}`} onClick={() => halls.remove(index)}>
                  <Trash2 aria-hidden />
                </Button>
              </fieldset>
            ))}
            <Button
              variant="outline"
              className="w-fit"
              onClick={() => halls.append({ hallId: `audi-${halls.fields.length + 1}`, name: `Audi ${halls.fields.length + 1}` })}
            >
              <Plus aria-hidden />
              Add hall
            </Button>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" loading={isSubmitting}>
            Create venue
          </Button>
          <Button asChild variant="ghost">
            <Link href="/manager/venues">Cancel</Link>
          </Button>
        </div>
      </form>
    </>
  );
}

type AddressErrors = Partial<Record<'line1' | 'line2' | 'state' | 'postalCode', { message?: string }>> | undefined;

function AddressFields({
  register,
  errors,
}: {
  // Both venue forms share the `address.*` shape.
  register: ReturnType<typeof useForm<VenueValues>>['register'] | ReturnType<typeof useForm<VenueEditValues>>['register'];
  errors: AddressErrors;
}) {
  const reg = register as ReturnType<typeof useForm<VenueEditValues>>['register'];
  return (
    <>
      <Field label="Address line 1" error={errors?.line1?.message} className="sm:col-span-2">
        <Input autoComplete="address-line1" {...reg('address.line1')} />
      </Field>
      <Field label="Address line 2" optional error={errors?.line2?.message} className="sm:col-span-2">
        <Input autoComplete="address-line2" {...reg('address.line2')} />
      </Field>
      <Field label="State" error={errors?.state?.message}>
        <Input autoComplete="address-level1" {...reg('address.state')} />
      </Field>
      <Field label="Postal code" error={errors?.postalCode?.message}>
        <Input autoComplete="postal-code" inputMode="numeric" {...reg('address.postalCode')} />
      </Field>
    </>
  );
}

export function VenueDetail() {
  const { id } = useParams<{ id: string }>();
  const venue = useVenue(id);

  if (venue.isLoading) return <LoadingRows label="Loading venue" />;
  if (venue.isError || !venue.data)
    return <QueryError error={venue.error} onRetry={() => void venue.refetch()} title="Could not load this venue" />;

  return (
    <>
      <PageHeader
        title={venue.data.name}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={venue.data.status} /> {cityLabel(venue.data.city)}
          </span>
        }
        back={{ href: '/manager/venues', label: 'Venues' }}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <HallsCard venue={venue.data} />
        <EditVenueCard key={venue.data.id} venue={venue.data} />
      </div>
    </>
  );
}

function HallsCard({ venue }: { venue: Venue }) {
  const addHall = useAddHall(venue.id);
  const [formError, setFormError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const form = useForm<HallValues>({ resolver: zodResolver(hallSchema), defaultValues: { hallId: '', name: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setAdded(null);
    try {
      await addHall.mutateAsync(values);
      setAdded(values.name);
      form.reset({ hallId: '', name: '' });
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Halls</CardTitle>
        <CardDescription>
          Design a seat layout for each hall. Saving a layout creates a new version; existing shows keep the version they were created with.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {venue.halls.length === 0 ? (
          <p className="text-muted-foreground text-sm">No halls yet. Add one below.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {venue.halls.map((hall) => (
              <li key={hall.hallId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div>
                  <p className="font-medium">{hall.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {hall.hallId} · {hall.layoutId ? 'Layout ready' : 'No layout yet'}
                  </p>
                </div>
                <Button asChild variant={hall.layoutId ? 'outline' : 'primary'} size="sm">
                  <Link href={`/manager/venues/${venue.id}/halls/${hall.hallId}/layout`}>
                    <LayoutGrid aria-hidden />
                    {hall.layoutId ? 'Edit layout' : 'Design layout'}
                    <span className="sr-only"> for {hall.name}</span>
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onSubmit} noValidate aria-label="Add a hall" className="flex flex-col gap-3 border-t pt-4">
          <h3 className="text-sm font-semibold">Add a hall</h3>
          <FormError message={formError} />
          <div aria-live="polite">{added ? <Notice tone="success">Hall “{added}” added.</Notice> : null}</div>
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Field label="Hall id" hint='Lower-case slug, e.g. "audi-2"' error={errors.hallId?.message}>
              <Input autoCapitalize="none" {...form.register('hallId')} />
            </Field>
            <Field label="Hall name" error={errors.name?.message}>
              <Input {...form.register('name')} />
            </Field>
          </div>
          <Button type="submit" variant="secondary" className="w-fit" loading={isSubmitting}>
            <Plus aria-hidden />
            Add hall
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EditVenueCard({ venue }: { venue: Venue }) {
  const update = useUpdateVenue(venue.id);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<VenueEditValues>({
    resolver: zodResolver(venueEditSchema),
    defaultValues: {
      name: venue.name,
      status: venue.status,
      address: {
        line1: venue.address.line1,
        line2: venue.address.line2 ?? '',
        state: venue.address.state,
        postalCode: venue.address.postalCode,
      },
    },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  const onSubmit = form.handleSubmit(async (raw) => {
    setFormError(null);
    setSaved(false);
    const values = venueEditSchema.parse(raw);
    try {
      const updated = await update.mutateAsync({
        name: values.name,
        status: values.status,
        address: { ...values.address, line2: values.address.line2 || undefined, country: venue.address.country },
      });
      form.reset({
        name: updated.name,
        status: updated.status,
        address: {
          line1: updated.address.line1,
          line2: updated.address.line2 ?? '',
          state: updated.address.state,
          postalCode: updated.address.postalCode,
        },
      });
      setSaved(true);
    } catch (error) {
      setFormError(applyServerErrors(error, form.setError));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Venue details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError message={formError} />
          <div aria-live="polite">{saved ? <Notice tone="success">Venue saved.</Notice> : null}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Venue name" error={errors.name?.message} className="sm:col-span-2">
              <Input {...form.register('name')} />
            </Field>
            <Field label="Status" hint="Inactive venues cannot get new shows." error={errors.status?.message}>
              <Select {...form.register('status')}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </Field>
            <div className="text-sm">
              <DefinitionList items={[{ term: 'City', value: cityLabel(venue.city) }]} />
            </div>
            <AddressFields register={form.register} errors={errors.address} />
          </div>
          <Button type="submit" className="w-fit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
