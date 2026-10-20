'use client';

import { Accessibility, ArrowDown, ArrowUp, Armchair, Plus, Save, Trash2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { memo, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Notice } from '@/components/ui/feedback';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/errors';
import { useLayout, useSaveLayout, useVenue } from '@/lib/api/hooks/manager';
import type { Layout, SeatType } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import {
  LIMITS,
  buildLayout,
  layoutToDrafts,
  newSection,
  nextSeatType,
  toLayoutInput,
  validateDrafts,
  type BuiltSeat,
  type SectionDraft,
} from './layout-generator';
import { LoadingRows, PageHeader, QueryError } from './page-parts';

export function LayoutBuilderPage() {
  const { id, hallId } = useParams<{ id: string; hallId: string }>();
  const venue = useVenue(id);
  const layout = useLayout(id, hallId);
  const hall = venue.data?.halls.find((item) => item.hallId === hallId);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);

  const back = { href: `/manager/venues/${id}`, label: venue.data?.name ?? 'Venue' };
  if (venue.isLoading || layout.isLoading) return <LoadingRows label="Loading layout" />;
  if (venue.isError) return <QueryError error={venue.error} onRetry={() => void venue.refetch()} title="Could not load this venue" />;
  if (layout.isError) return <QueryError error={layout.error} onRetry={() => void layout.refetch()} title="Could not load the layout" />;
  if (!hall) return <QueryError error={new Error('Hall not found')} title="This hall does not exist" />;

  return (
    <>
      <PageHeader
        title={`Seat layout · ${hall.name}`}
        description={layout.data ? `Current version ${layout.data.version} · ${layout.data.totalSeats} seats` : 'No layout saved yet.'}
        back={back}
      />
      {/* Lives outside Builder: Builder remounts on the new version, which would drop the notice. */}
      <div aria-live="polite">{savedVersion ? <Notice tone="success">Saved as version {savedVersion}.</Notice> : null}</div>
      {/* Remount when a new version is saved so the editor starts from it. */}
      <Builder key={layout.data?.version ?? 'new'} venueId={id} hallId={hallId} saved={layout.data ?? null} onSaved={setSavedVersion} />
    </>
  );
}

function Builder({
  venueId,
  hallId,
  saved,
  onSaved,
}: {
  venueId: string;
  hallId: string;
  saved: Layout | null;
  onSaved: (version: number | null) => void;
}) {
  const [drafts, setDrafts] = useState<SectionDraft[]>(() => (saved ? layoutToDrafts(saved) : [newSection([])]));
  const [dirty, setDirty] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = useSaveLayout(venueId, hallId);

  const built = useMemo(() => buildLayout(drafts), [drafts]);
  const problems = useMemo(() => validateDrafts(drafts), [drafts]);
  const counts = useMemo(() => {
    const result: Record<SeatType, number> = { REGULAR: 0, RECLINER: 0, WHEELCHAIR: 0, GAP: 0 };
    for (const section of built.sections) for (const row of section.rows) for (const seat of row.seats) result[seat.type] += 1;
    return result;
  }, [built]);

  const update = (key: string, patch: Partial<SectionDraft>) => {
    setDirty(true);
    onSaved(null);
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };
  const move = (index: number, delta: -1 | 1) => {
    setDirty(true);
    setDrafts((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + delta, 0, item);
      return next;
    });
  };
  const toggleSeat = (sectionKey: string, seat: BuiltSeat) => {
    const draft = drafts.find((item) => item.key === sectionKey);
    if (!draft) return;
    const type = nextSeatType(seat.type);
    const overrides = { ...draft.overrides };
    if (type === 'REGULAR') delete overrides[seat.overrideKey];
    else overrides[seat.overrideKey] = type;
    update(sectionKey, { overrides });
  };

  const onSave = async () => {
    setSaveError(null);
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    try {
      const layout = await save.mutateAsync(toLayoutInput(built));
      onSaved(layout.version);
      setDirty(false);
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {saved ? (
        <Notice>
          Saving creates <strong>version {saved.version + 1}</strong>. Shows already scheduled keep the layout version they were created
          with; new shows use the latest version.
        </Notice>
      ) : null}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section aria-labelledby="sections-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="sections-heading" className="text-lg font-semibold">
              Sections
            </h2>
            <Button
              variant="outline"
              size="sm"
              disabled={drafts.length >= LIMITS.sections}
              onClick={() => {
                setDirty(true);
                setDrafts((current) => [...current, newSection(current)]);
              }}
            >
              <Plus aria-hidden />
              Add section
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Front (closest to the screen or stage) first. Row labels run A, B, C… from front to back across sections.
          </p>
          {drafts.map((draft, index) => (
            <SectionEditor
              key={draft.key}
              draft={draft}
              index={index}
              total={drafts.length}
              onChange={(patch) => update(draft.key, patch)}
              onMove={(delta) => move(index, delta)}
              onRemove={() => {
                setDirty(true);
                setDrafts((current) => current.filter((item) => item.key !== draft.key));
              }}
            />
          ))}
        </section>

        <section aria-labelledby="preview-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="preview-heading" className="text-lg font-semibold">
              Preview
            </h2>
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {built.seatCount} bookable seats · {counts.RECLINER} recliner · {counts.WHEELCHAIR} wheelchair · {counts.GAP} gaps
            </p>
          </div>
          <Legend />
          <Preview built={built} onToggle={toggleSeat} />
        </section>
      </div>

      <div className="bg-background/95 sticky bottom-0 -mx-4 flex flex-col gap-3 border-t px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {showProblems && problems.length > 0 ? (
          <div role="alert" className="border-danger/40 bg-danger/10 text-danger rounded-md border px-3 py-2 text-sm">
            <p className="font-medium">Fix these before saving:</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <FormError message={saveError} />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onSave} loading={save.isPending} disabled={!dirty && saved !== null}>
            <Save aria-hidden />
            {saved ? 'Save new version' : 'Save layout'}
          </Button>
          {dirty ? <span className="text-muted-foreground text-sm">Unsaved changes</span> : null}
        </div>
      </div>
    </div>
  );
}

function SectionEditor({
  draft,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  draft: SectionDraft;
  index: number;
  total: number;
  onChange: (patch: Partial<SectionDraft>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const label = draft.name.trim() || `Section ${index + 1}`;
  const int = (value: string) => (value === '' ? 0 : Math.trunc(Number(value)));
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <h3 className="text-base font-semibold">{label}</h3>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Move ${label} towards the front`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Move ${label} towards the back`}
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Remove ${label}`} disabled={total === 1} onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input value={draft.name} maxLength={64} onChange={(event) => onChange({ name: event.target.value })} />
        </Field>
        <Field label="Code" hint="UPPER_SNAKE, unique">
          <Input
            value={draft.code}
            maxLength={32}
            autoCapitalize="characters"
            onChange={(event) => onChange({ code: event.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Price tier" hint="Priced per show">
          <Input
            value={draft.priceTier}
            maxLength={32}
            autoCapitalize="characters"
            onChange={(event) => onChange({ priceTier: event.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Rows" hint={`1–${LIMITS.rowsPerSection}`}>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={LIMITS.rowsPerSection}
            value={draft.rows || ''}
            onChange={(event) => onChange({ rows: int(event.target.value) })}
          />
        </Field>
        <Field label="Seats per row" hint={`1–${LIMITS.seatsPerRow}`}>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={LIMITS.seatsPerRow}
            value={draft.seatsPerRow || ''}
            onChange={(event) => onChange({ seatsPerRow: int(event.target.value) })}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

const TYPE_LABEL: Record<SeatType, string> = {
  REGULAR: 'regular',
  RECLINER: 'recliner',
  WHEELCHAIR: 'wheelchair space',
  GAP: 'gap (no seat)',
};

function Legend() {
  const items: { type: SeatType; text: string }[] = [
    { type: 'REGULAR', text: 'Regular (shows seat number)' },
    { type: 'RECLINER', text: 'Recliner' },
    { type: 'WHEELCHAIR', text: 'Wheelchair space' },
    { type: 'GAP', text: 'Gap / aisle (not bookable)' },
  ];
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label="Seat types">
      {items.map((item) => (
        <li key={item.type} className="flex items-center gap-1.5">
          <SeatGlyph type={item.type} number={1} />
          {item.text}
        </li>
      ))}
      <li>Click a seat (or press Enter) to change its type. Arrow keys move between seats.</li>
    </ul>
  );
}

function SeatGlyph({ type, number }: { type: SeatType; number: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none font-medium',
        type === 'REGULAR' && 'border-foreground/40 bg-background',
        type === 'RECLINER' && 'border-primary bg-accent text-primary',
        type === 'WHEELCHAIR' && 'border-success bg-success/10 text-success',
        type === 'GAP' && 'border-border border-dashed bg-transparent text-transparent',
      )}
    >
      {type === 'REGULAR' ? (
        number
      ) : type === 'RECLINER' ? (
        <Armchair className="size-3.5" />
      ) : type === 'WHEELCHAIR' ? (
        <Accessibility className="size-3.5" />
      ) : (
        '·'
      )}
    </span>
  );
}

/**
 * Seat grid with one tab stop (roving tabindex): Tab enters the grid, arrow keys move by row/column,
 * Enter/Space cycles the focused seat's type.
 */
const Preview = memo(function Preview({
  built,
  onToggle,
}: {
  built: ReturnType<typeof buildLayout>;
  onToggle: (sectionKey: string, seat: BuiltSeat) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const firstId = built.sections[0]?.rows[0]?.seats[0]?.id ?? null;
  const exists = useMemo(() => new Set(built.sections.flatMap((s) => s.rows.flatMap((r) => r.seats.map((seat) => seat.id)))), [built]);
  const focusId = active && exists.has(active) ? active : firstId;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const line = Number(target.dataset.line);
    const column = Number(target.dataset.column);
    if (!Number.isFinite(line) || !Number.isFinite(column)) return;
    const seats = [...(container.current?.querySelectorAll<HTMLButtonElement>('[data-seat]') ?? [])];
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const row = seats.filter((seat) => Number(seat.dataset.line) === line);
      next = row[row.findIndex((seat) => seat === target) + step];
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const lines = [...new Set(seats.map((seat) => Number(seat.dataset.line)))].sort((a, b) => a - b);
      const targetLine = lines[lines.indexOf(line) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (targetLine !== undefined) {
        const row = seats.filter((seat) => Number(seat.dataset.line) === targetLine);
        next = row.reduce<HTMLButtonElement | undefined>(
          (best, seat) =>
            !best || Math.abs(Number(seat.dataset.column) - column) < Math.abs(Number(best.dataset.column) - column) ? seat : best,
          undefined,
        );
      }
    } else if (event.key === 'Home' || event.key === 'End') {
      const row = seats.filter((seat) => Number(seat.dataset.line) === line);
      next = event.key === 'Home' ? row[0] : row.at(-1);
    } else {
      return;
    }
    event.preventDefault();
    if (next) {
      setActive(next.dataset.seat ?? null);
      next.focus();
    }
  };

  return (
    <div className="bg-muted/30 overflow-auto rounded-lg border p-4">
      <div className="border-foreground/30 text-muted-foreground mx-auto mb-4 w-2/3 rounded-sm border-t-4 pt-1 text-center text-xs tracking-widest uppercase">
        Screen / stage
      </div>
      <div
        ref={container}
        onKeyDown={onKeyDown}
        role="group"
        aria-label="Seat layout preview"
        className="flex w-max min-w-full flex-col items-center gap-4"
      >
        {built.sections.map((section) => (
          <div key={section.key} className="flex flex-col gap-1">
            <p className="text-muted-foreground text-center text-xs font-semibold">
              {section.name || section.code} · {section.priceTier}
            </p>
            {section.rows.map((row) => (
              <div key={row.label} className="flex items-center gap-1" role="group" aria-label={`Row ${row.label}`}>
                <span aria-hidden className="text-muted-foreground w-7 shrink-0 text-right text-[10px] font-medium">
                  {row.label}
                </span>
                <div className="flex gap-1" style={{ paddingLeft: `${(row.seats[0]?.column ?? 0) * 1.75}rem` }}>
                  {row.seats.map((seat) => (
                    <button
                      key={seat.id}
                      type="button"
                      data-seat={seat.id}
                      data-line={row.line}
                      data-column={seat.column}
                      tabIndex={seat.id === focusId ? 0 : -1}
                      aria-label={`Row ${row.label} seat ${seat.number}, ${TYPE_LABEL[seat.type]}`}
                      onFocus={() => setActive(seat.id)}
                      onClick={() => onToggle(section.key, seat)}
                      className="rounded-sm"
                    >
                      <SeatGlyph type={seat.type} number={seat.number} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-4 text-center text-xs">Back of the hall</p>
    </div>
  );
});
