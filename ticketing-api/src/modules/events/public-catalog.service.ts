import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { type Model, Types } from 'mongoose';
import { notFound } from '../../common/errors/domain.exception.js';
import { pageOf, type Page } from '../../common/validation/zod.js';
import { redisKeys } from '../../infra/redis/redis-keys.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PUBLIC_SEAT_STATUS } from '../inventory/seats.gateway.js';
import { CatalogCacheService } from './catalog-cache.service.js';
import { pricingDto, toEventDto, toShowDto } from './catalog.mappers.js';
import type { BrowseEventsQuery, EventShowsQuery } from './dto/catalog.dto.js';
import { Event } from './schemas/event.schema.js';
import { SeatLayout } from './schemas/seat-layout.schema.js';
import { Show } from './schemas/show.schema.js';
import { Venue } from './schemas/venue.schema.js';

/** Calendar days in browse filters are interpreted in the business timezone (IST). */
const BUSINESS_UTC_OFFSET = '+05:30';
const dayRange = (date: string) => {
  const start = new Date(`${date}T00:00:00${BUSINESS_UTC_OFFSET}`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
};

const TTL = { search: 30, event: 300, eventShows: 60, show: 60, layout: 3600, cities: 300 } as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type EventDto = ReturnType<typeof toEventDto>;

/**
 * Customer-facing reads. Only PUBLISHED events and ON_SALE, upcoming shows are
 * visible. Results are cached in Redis (see CatalogCacheService).
 */
@Injectable()
export class PublicCatalogService {
  constructor(
    @InjectModel(Venue.name) private readonly venues: Model<Venue>,
    @InjectModel(SeatLayout.name) private readonly layouts: Model<SeatLayout>,
    @InjectModel(Event.name) private readonly events: Model<Event>,
    @InjectModel(Show.name) private readonly shows: Model<Show>,
    private readonly inventory: InventoryService,
    private readonly cache: CatalogCacheService,
  ) {}

  /** Shows that customers can buy right now. */
  private upcomingOnSale(extra: mongoose.QueryFilter<Show> = {}): mongoose.QueryFilter<Show> {
    return { status: 'ON_SALE', startsAt: mongoose.trusted({ $gt: new Date() }), ...extra };
  }

  cities(): Promise<string[]> {
    return this.cache.getOrLoad('cache:cities', TTL.cities, async () =>
      ((await this.shows.distinct('city', this.upcomingOnSale())) as string[]).sort(),
    );
  }

  browseEvents(query: BrowseEventsQuery): Promise<Page<EventDto>> {
    return this.cache.getOrLoad(CatalogCacheService.searchKey(query), TTL.search, async () => {
      const showFilter: mongoose.QueryFilter<Show> = this.upcomingOnSale();
      if (query.city) showFilter['city'] = query.city;
      if (query.date) {
        const { start, end } = dayRange(query.date);
        showFilter['startsAt'] = mongoose.trusted({ $gte: start > new Date() ? start : new Date(), $lt: end });
      }
      const eventIds = (await this.shows.distinct('eventId', showFilter)) as Types.ObjectId[];

      const eventFilter: mongoose.QueryFilter<Event> = { _id: mongoose.trusted({ $in: eventIds }), status: 'PUBLISHED' };
      if (query.category) eventFilter['category'] = query.category;
      if (query.q) eventFilter['$text'] = mongoose.trusted({ $search: query.q });

      const find = this.events.find(eventFilter);
      if (query.q) find.select({ score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } });
      else find.sort({ createdAt: -1 });

      const [rows, total] = await Promise.all([
        find
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
        this.events.countDocuments(eventFilter),
      ]);
      return pageOf(rows.map(toEventDto), total, query);
    });
  }

  /** By id or slug. */
  async event(idOrSlug: string): Promise<EventDto> {
    const filter =
      Types.ObjectId.isValid(idOrSlug) && /^[0-9a-f]{24}$/.test(idOrSlug)
        ? { _id: new Types.ObjectId(idOrSlug) }
        : SLUG.test(idOrSlug)
          ? { slug: idOrSlug }
          : null;
    if (!filter) throw notFound('Event');

    const load = async () => {
      const event = await this.events.findOne({ ...filter, status: 'PUBLISHED' }).lean();
      if (!event) throw notFound('Event');
      return toEventDto(event);
    };
    return '_id' in filter ? this.cache.getOrLoad(redisKeys.eventCache(idOrSlug), TTL.event, load) : load();
  }

  async eventShows(eventId: string, query: EventShowsQuery) {
    const all = await this.cache.getOrLoad(redisKeys.eventShowsCache(eventId), TTL.eventShows, async () => {
      const shows = await this.shows
        .find(this.upcomingOnSale({ eventId: new Types.ObjectId(eventId) }))
        .sort({ startsAt: 1 })
        .lean();
      const venueIds = [...new Set(shows.map((s) => s.venueId.toHexString()))].map((id) => new Types.ObjectId(id));
      const venues = new Map(
        (await this.venues.find({ _id: mongoose.trusted({ $in: venueIds }) }).lean()).map((v) => [v._id.toHexString(), v]),
      );
      return shows.map((s) => {
        const venue = venues.get(s.venueId.toHexString());
        return {
          ...toShowDto(s),
          venue: venue
            ? {
                id: venue._id.toHexString(),
                name: venue.name,
                city: venue.city,
                hallName: venue.halls.find((h) => h.hallId === s.hallId)?.name ?? s.hallId,
              }
            : null,
        };
      });
    });
    const now = Date.now();
    return all.filter((s) => {
      if (Date.parse(s.startsAt) <= now) return false;
      if (query.city && s.city !== query.city) return false;
      if (query.date) {
        const { start, end } = dayRange(query.date);
        const t = Date.parse(s.startsAt);
        if (t < start.getTime() || t >= end.getTime()) return false;
      }
      return true;
    });
  }

  async show(showId: string) {
    return this.cache.getOrLoad(redisKeys.showCache(showId), TTL.show, async () => {
      const show = await this.shows
        .findOne({ _id: new Types.ObjectId(showId), status: mongoose.trusted({ $in: ['ON_SALE', 'CANCELLED'] }) })
        .lean();
      if (!show) throw notFound('Show');
      const [event, venue] = await Promise.all([this.events.findById(show.eventId).lean(), this.venues.findById(show.venueId).lean()]);
      if (!event || event.status !== 'PUBLISHED' || !venue) throw notFound('Show');
      return {
        ...toShowDto(show),
        event: {
          id: event._id.toHexString(),
          title: event.title,
          slug: event.slug,
          durationMins: event.durationMins,
          posterUrl: event.posterUrl ?? null,
          ageRating: event.ageRating ?? null,
        },
        venue: {
          id: venue._id.toHexString(),
          name: venue.name,
          city: venue.city,
          address: venue.address,
          hallName: venue.halls.find((h) => h.hallId === show.hallId)?.name ?? show.hallId,
        },
      };
    });
  }

  /**
   * Fresh (uncached) state for booking decisions: is this show buyable right now?
   */
  async saleableShow(showId: string) {
    const show = await this.shows.findById(new Types.ObjectId(showId)).lean();
    if (!show) throw notFound('Show');
    const now = new Date();
    return {
      id: showId,
      eventId: show.eventId.toHexString(),
      managerId: show.managerId,
      status: show.status,
      startsAt: show.startsAt,
      currency: show.currency,
      onSale: show.status === 'ON_SALE' && show.salesOpenAt <= now && show.startsAt > now,
    };
  }

  /** Shows cancelled in the last 30 days (show-cancellation reconciler). */
  async recentlyCancelledShowIds(): Promise<string[]> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.shows
      .find({ status: 'CANCELLED', updatedAt: mongoose.trusted({ $gte: since }) })
      .select('_id')
      .lean();
    return rows.map((s) => s._id.toHexString());
  }

  /** Display data for bookings / tickets / emails, for many shows at once. */
  async showSummaries(showIds: string[]) {
    const ids = [...new Set(showIds)].map((id) => new Types.ObjectId(id));
    const shows = await this.shows.find({ _id: mongoose.trusted({ $in: ids }) }).lean();
    const [events, venues] = await Promise.all([
      this.events
        .find({
          _id: mongoose.trusted({ $in: [...new Set(shows.map((s) => s.eventId.toHexString()))].map((id) => new Types.ObjectId(id)) }),
        })
        .lean(),
      this.venues
        .find({
          _id: mongoose.trusted({ $in: [...new Set(shows.map((s) => s.venueId.toHexString()))].map((id) => new Types.ObjectId(id)) }),
        })
        .lean(),
    ]);
    const eventById = new Map(events.map((e) => [e._id.toHexString(), e]));
    const venueById = new Map(venues.map((v) => [v._id.toHexString(), v]));
    return new Map(
      shows.map((s) => {
        const event = eventById.get(s.eventId.toHexString());
        const venue = venueById.get(s.venueId.toHexString());
        return [
          s._id.toHexString(),
          {
            showId: s._id.toHexString(),
            eventId: s.eventId.toHexString(),
            eventTitle: event?.title ?? 'Event',
            posterUrl: event?.posterUrl ?? null,
            venueName: venue?.name ?? 'Venue',
            city: s.city,
            hallName: venue?.halls.find((h) => h.hallId === s.hallId)?.name ?? s.hallId,
            startsAt: s.startsAt.toISOString(),
            showStatus: s.status,
          },
        ] as const;
      }),
    );
  }

  /** Layout (cached — immutable per version) merged with live seat status and tier prices. */
  async seatMap(showId: string) {
    const show = await this.shows.findOne({ _id: new Types.ObjectId(showId), status: 'ON_SALE' }).lean();
    if (!show) throw notFound('Show');
    const layoutId = show.layoutId.toHexString();
    const [layout, statuses] = await Promise.all([
      this.cache.getOrLoad(redisKeys.layoutCache(layoutId), TTL.layout, async () => {
        const doc = await this.layouts.findById(show.layoutId).lean();
        if (!doc) throw notFound('Layout');
        return { sections: doc.sections, totalSeats: doc.totalSeats };
      }),
      this.inventory.seatStatuses(showId),
    ]);
    const prices = pricingDto(show.pricing);
    let available = 0;
    const sections = layout.sections.map((section) => ({
      code: section.code,
      name: section.name,
      priceTier: section.priceTier,
      price: prices[section.priceTier] ?? null,
      rows: section.rows.map((row) => ({
        label: row.label,
        seats: row.seats.map((seat) => {
          if (seat.type === 'GAP') return { id: seat.id, number: seat.number, x: seat.x, y: seat.y, type: seat.type, status: null };
          const status = PUBLIC_SEAT_STATUS(statuses.get(seat.id) ?? 'BLOCKED');
          if (status === 'AVAILABLE') available++;
          return { id: seat.id, number: seat.number, x: seat.x, y: seat.y, type: seat.type, status };
        }),
      })),
    }));
    return {
      showId,
      currency: show.currency,
      salesOpen: show.salesOpenAt <= new Date() && show.startsAt > new Date(),
      totalSeats: layout.totalSeats,
      availableSeats: available,
      sections,
    };
  }
}
