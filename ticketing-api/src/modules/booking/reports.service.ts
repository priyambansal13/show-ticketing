import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.decorators.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { ManagerCatalogService } from '../events/manager-catalog.service.js';
import { PublicCatalogService } from '../events/public-catalog.service.js';
import { RefundRequests } from '../ledger/refund-requests.js';
import type { SalesReportQuery } from './dto/booking.dto.js';

const IST = '+05:30';
const MAX_RANGE_DAYS = 366;

interface ShowStatsRow {
  show_id: string;
  total_seats: number;
  sold_seats: number;
  held_seats: number;
  blocked_seats: number;
}

interface BookingStatsRow {
  show_id: string;
  confirmed_bookings: number;
  cancelled_bookings: number;
  gross: string;
}

/** Manager dashboards: sales, refunds and occupancy per show (read side). */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly managerCatalog: ManagerCatalogService,
    private readonly catalog: PublicCatalogService,
    private readonly ledger: RefundRequests,
  ) {}

  async sales(manager: AuthUser, query: SalesReportQuery) {
    const from = query.from ? new Date(`${query.from}T00:00:00${IST}`) : undefined;
    const to = query.to ? new Date(new Date(`${query.to}T00:00:00${IST}`).getTime() + 86_400_000) : undefined;
    if (from && to && (to <= from || to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000)) {
      throw new DomainException('INVALID_RANGE', `Range must be positive and at most ${MAX_RANGE_DAYS} days`);
    }
    const showIds = await this.managerCatalog.ownedShowIds(manager, { from, to });
    if (showIds.length === 0) return { totals: emptyTotals(), shows: [] };

    const [seatStats, bookingStats, refundsByShow, summaries] = await Promise.all([
      this.prisma.$queryRaw<ShowStatsRow[]>`
        SELECT show_id,
               count(*)::int                                   AS total_seats,
               count(*) FILTER (WHERE status = 'BOOKED')::int  AS sold_seats,
               count(*) FILTER (WHERE status = 'HELD')::int    AS held_seats,
               count(*) FILTER (WHERE status = 'BLOCKED')::int AS blocked_seats
          FROM show_seats WHERE show_id = ANY(${showIds}) GROUP BY show_id`,
      this.prisma.$queryRaw<BookingStatsRow[]>`
        SELECT b.show_id,
               count(*) FILTER (WHERE b.status = 'CONFIRMED')::int AS confirmed_bookings,
               count(*) FILTER (WHERE b.status = 'CANCELLED')::int AS cancelled_bookings,
               coalesce(sum(b.total_amount) FILTER (WHERE b.status IN ('CONFIRMED', 'CANCELLED')), 0)::text AS gross
          FROM bookings b WHERE b.show_id = ANY(${showIds}) GROUP BY b.show_id`,
      // Only refunds of revenue (cancellations) — duplicate/late-payment refunds were never revenue.
      this.ledger.revenueRefundsByShow(showIds),
      this.catalog.showSummaries(showIds),
    ]);

    const NO_BOOKINGS: BookingStatsRow = { show_id: '', confirmed_bookings: 0, cancelled_bookings: 0, gross: '0' };
    const bookingsByShow = new Map(bookingStats.map((r) => [r.show_id, r]));
    // Shows without inventory (never published) have no seat rows and are not reported.
    const shows = seatStats
      .flatMap((seats) => {
        const show = summaries.get(seats.show_id);
        return show
          ? [
              {
                show,
                seats,
                bookings: bookingsByShow.get(seats.show_id) ?? NO_BOOKINGS,
                refunded: refundsByShow.get(seats.show_id) ?? new Prisma.Decimal(0),
              },
            ]
          : [];
      })
      .map(({ show, seats, bookings: b, refunded }) => {
        const gross = new Prisma.Decimal(b.gross);
        const sellable = seats.total_seats - seats.blocked_seats;
        return {
          show,
          seats: { total: seats.total_seats, sold: seats.sold_seats, held: seats.held_seats, blocked: seats.blocked_seats },
          occupancyPercent: sellable > 0 ? Math.round((seats.sold_seats / sellable) * 1000) / 10 : 0,
          bookings: { confirmed: b.confirmed_bookings, cancelled: b.cancelled_bookings },
          grossRevenue: gross.toFixed(2),
          refunded: refunded.toFixed(2),
          netRevenue: gross.minus(refunded).toFixed(2),
        };
      })
      .sort((x, y) => y.show.startsAt.localeCompare(x.show.startsAt));

    const totals = shows.reduce(
      (acc, s) => ({
        shows: acc.shows + 1,
        seatsSold: acc.seatsSold + s.seats.sold,
        confirmedBookings: acc.confirmedBookings + s.bookings.confirmed,
        grossRevenue: acc.grossRevenue.plus(s.grossRevenue),
        refunded: acc.refunded.plus(s.refunded),
      }),
      { shows: 0, seatsSold: 0, confirmedBookings: 0, grossRevenue: new Prisma.Decimal(0), refunded: new Prisma.Decimal(0) },
    );
    return {
      totals: {
        ...totals,
        grossRevenue: totals.grossRevenue.toFixed(2),
        refunded: totals.refunded.toFixed(2),
        netRevenue: totals.grossRevenue.minus(totals.refunded).toFixed(2),
      },
      shows,
    };
  }
}

const emptyTotals = () => ({ shows: 0, seatsSold: 0, confirmedBookings: 0, grossRevenue: '0.00', refunded: '0.00', netRevenue: '0.00' });
