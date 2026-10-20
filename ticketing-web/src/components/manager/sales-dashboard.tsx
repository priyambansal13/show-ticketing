'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSalesReport } from '@/lib/api/hooks/manager';
import type { SalesQuery } from '@/lib/api/types';
import { cityLabel, formatDateTime, formatMoney, toIsoDay } from '@/lib/format';
import { downloadText, salesReportCsv } from './csv';
import { PageHeader, QueryError, TableWrap, tdClass, thClass } from './page-parts';

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultRange(): { from: string; to: string } {
  const now = Date.now();
  return { from: toIsoDay(new Date(now - 30 * DAY_MS)), to: toIsoDay(new Date(now + 60 * DAY_MS)) };
}

export function SalesDashboard() {
  const [range, setRange] = useState(defaultRange);
  const [draft, setDraft] = useState(range);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const query: SalesQuery = { from: range.from, to: range.to };
  const report = useSalesReport(query);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setRangeError('"From" must be on or before "To".');
      return;
    }
    setRangeError(null);
    setRange(draft);
  };

  const exportCsv = () => {
    if (report.data) downloadText(`sales-${range.from}-to-${range.to}.csv`, salesReportCsv(report.data));
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Sales and occupancy for shows starting in the selected period (IST)."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={!report.data || report.data.shows.length === 0}>
            <Download aria-hidden />
            Export CSV
          </Button>
        }
      />

      <form onSubmit={apply} className="mb-6 flex flex-wrap items-end gap-3" aria-label="Report period">
        <Field label="From" className="w-44">
          <Input
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(event) => setDraft((d) => ({ ...d, from: event.target.value }))}
            required
          />
        </Field>
        <Field label="To" className="w-44" error={rangeError ?? undefined}>
          <Input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(event) => setDraft((d) => ({ ...d, to: event.target.value }))}
            required
          />
        </Field>
        <Button type="submit" variant="secondary" loading={report.isFetching && !report.isLoading}>
          Update
        </Button>
      </form>

      {report.isLoading ? (
        <div role="status" aria-label="Loading report" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : report.isError ? (
        <QueryError error={report.error} onRetry={() => void report.refetch()} title="Could not load the sales report" />
      ) : report.data ? (
        <>
          <section aria-labelledby="totals-heading">
            <h2 id="totals-heading" className="sr-only">
              Totals
            </h2>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Stat label="Shows" value={report.data.totals.shows.toLocaleString('en-IN')} />
              <Stat label="Seats sold" value={report.data.totals.seatsSold.toLocaleString('en-IN')} />
              <Stat label="Confirmed bookings" value={report.data.totals.confirmedBookings.toLocaleString('en-IN')} />
              <Stat label="Gross revenue" value={formatMoney(report.data.totals.grossRevenue)} />
              <Stat label="Refunded" value={formatMoney(report.data.totals.refunded)} />
              <Stat label="Net revenue" value={formatMoney(report.data.totals.netRevenue)} emphasis />
            </dl>
          </section>

          <section aria-labelledby="shows-heading" className="mt-8">
            <h2 id="shows-heading" className="mb-3 text-lg font-semibold">
              Shows
            </h2>
            {report.data.shows.length === 0 ? (
              <EmptyState
                title="No shows in this period"
                description="Pick a wider date range, or schedule a show."
                action={
                  <Button asChild size="sm">
                    <Link href="/manager/shows/new">Schedule a show</Link>
                  </Button>
                }
              />
            ) : (
              <TableWrap>
                <table className="w-full min-w-[56rem] text-sm">
                  <caption className="sr-only">Sales and occupancy per show</caption>
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th scope="col" className={thClass}>
                        Show
                      </th>
                      <th scope="col" className={thClass}>
                        Status
                      </th>
                      <th scope="col" className={thClass}>
                        Occupancy
                      </th>
                      <th scope="col" className={`${thClass} text-right`}>
                        Bookings
                      </th>
                      <th scope="col" className={`${thClass} text-right`}>
                        Net revenue
                      </th>
                      <th scope="col" className={thClass}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.data.shows.map((row) => (
                      <tr key={row.show.showId}>
                        <td className={tdClass}>
                          <Link href={`/manager/shows/${row.show.showId}`} className="font-medium hover:underline">
                            {row.show.eventTitle}
                          </Link>
                          <div className="text-muted-foreground text-xs">
                            {formatDateTime(row.show.startsAt)} · {row.show.venueName}, {row.show.hallName} · {cityLabel(row.show.city)}
                          </div>
                        </td>
                        <td className={tdClass}>
                          <StatusBadge status={row.show.showStatus} />
                        </td>
                        <td className={tdClass}>
                          <Occupancy
                            percent={row.occupancyPercent}
                            sold={row.seats.sold}
                            total={row.seats.total}
                            held={row.seats.held}
                            blocked={row.seats.blocked}
                          />
                        </td>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {row.bookings.confirmed}
                          {row.bookings.cancelled > 0 ? (
                            <div className="text-muted-foreground text-xs">{row.bookings.cancelled} cancelled</div>
                          ) : null}
                        </td>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {formatMoney(row.netRevenue)}
                          {Number(row.refunded) > 0 ? (
                            <div className="text-muted-foreground text-xs">{formatMoney(row.refunded)} refunded</div>
                          ) : null}
                        </td>
                        <td className={`${tdClass} text-right`}>
                          <Link
                            href={`/manager/shows/${row.show.showId}/bookings`}
                            className="text-primary text-sm font-medium hover:underline"
                          >
                            Bookings<span className="sr-only"> for {row.show.eventTitle}</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <Card className="p-4">
      <dt className="text-muted-foreground text-xs font-medium uppercase">{label}</dt>
      <dd className={`mt-1 text-xl font-semibold tabular-nums ${emphasis ? 'text-primary' : ''}`}>{value}</dd>
    </Card>
  );
}

function Occupancy({
  percent,
  sold,
  total,
  held,
  blocked,
}: {
  percent: number;
  sold: number;
  total: number;
  held: number;
  blocked: number;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="font-medium tabular-nums">{clamped.toFixed(clamped % 1 === 0 ? 0 : 1)}%</span>
        <span className="text-muted-foreground tabular-nums">
          {sold}/{total} sold
        </span>
      </div>
      <div
        role="meter"
        aria-label="Occupancy"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped}% — ${sold} of ${total} seats sold`}
        className="bg-muted h-2 overflow-hidden rounded-full"
      >
        <div className="bg-primary h-full rounded-full" style={{ width: `${clamped}%` }} />
      </div>
      {held > 0 || blocked > 0 ? (
        <span className="text-muted-foreground text-xs">
          {held > 0 ? `${held} held` : ''}
          {held > 0 && blocked > 0 ? ' · ' : ''}
          {blocked > 0 ? `${blocked} blocked` : ''}
        </span>
      ) : null}
    </div>
  );
}
