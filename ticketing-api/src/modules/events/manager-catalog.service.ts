import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { type Model, Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../../common/auth/auth.decorators.js';
import { DomainException, notFound } from '../../common/errors/domain.exception.js';
import { pageOf, type Pagination } from '../../common/validation/zod.js';
import { AuditService } from '../audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CatalogCacheService } from './catalog-cache.service.js';
import { toEventDto, toLayoutDto, toShowDto, toVenueDto } from './catalog.mappers.js';
import type {
  AddHall,
  CreateEvent,
  CreateShow,
  CreateVenue,
  ManagerShowsQuery,
  PutLayout,
  UpdateEvent,
  UpdateShow,
  UpdateVenue,
} from './dto/catalog.dto.js';
import { Event } from './schemas/event.schema.js';
import { SeatLayout } from './schemas/seat-layout.schema.js';
import { Show } from './schemas/show.schema.js';
import { Venue } from './schemas/venue.schema.js';

const oid = (id: string) => new Types.ObjectId(id);

const slugify = (title: string) =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'event';

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

/**
 * Everything a manager creates: venues, hall layouts, events, shows. Every
 * lookup is scoped by managerId — another manager's resource is a 404, never a 403.
 * Fields with cross-field rules are changed via document.save() (schema guards
 * reject query updates of them).
 */
@Injectable()
export class ManagerCatalogService {
  constructor(
    @InjectModel(Venue.name) private readonly venues: Model<Venue>,
    @InjectModel(SeatLayout.name) private readonly layouts: Model<SeatLayout>,
    @InjectModel(Event.name) private readonly events: Model<Event>,
    @InjectModel(Show.name) private readonly shows: Model<Show>,
    private readonly inventory: InventoryService,
    private readonly cache: CatalogCacheService,
    private readonly audit: AuditService,
  ) {}

  // ── Venues ──────────────────────────────────────────────────────────────

  async createVenue(manager: AuthUser, input: CreateVenue) {
    const venue = await this.venues.create({ ...input, managerId: manager.id });
    await this.audit.recordStandalone({ actor: manager, action: 'venue.created', entity: 'venue', entityId: venue.id as string });
    return toVenueDto(venue.toObject());
  }

  async listVenues(manager: AuthUser, page: Pagination) {
    const filter = { managerId: manager.id };
    const [rows, total] = await Promise.all([
      this.venues
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page.page - 1) * page.limit)
        .limit(page.limit)
        .lean(),
      this.venues.countDocuments(filter),
    ]);
    return pageOf(rows.map(toVenueDto), total, page);
  }

  async getVenue(manager: AuthUser, venueId: string) {
    return toVenueDto((await this.ownedVenue(manager, venueId)).toObject());
  }

  async updateVenue(manager: AuthUser, venueId: string, input: UpdateVenue) {
    const venue = await this.ownedVenue(manager, venueId);
    venue.set(input);
    await venue.save();
    return toVenueDto(venue.toObject());
  }

  async addHall(manager: AuthUser, venueId: string, input: AddHall) {
    const venue = await this.ownedVenue(manager, venueId);
    if (venue.halls.some((h) => h.hallId === input.hallId)) {
      throw new DomainException('HALL_EXISTS', `Hall "${input.hallId}" already exists`, HttpStatus.CONFLICT);
    }
    venue.halls.push(input);
    await venue.save();
    return toVenueDto(venue.toObject());
  }

  /** Layouts are immutable: every PUT stores a new version and points the hall at it. */
  async putLayout(manager: AuthUser, venueId: string, hallId: string, input: PutLayout) {
    const venue = await this.ownedVenue(manager, venueId);
    if (!venue.halls.some((h) => h.hallId === hallId)) throw notFound('Hall');

    const latest = await this.layouts.findOne({ venueId: venue._id, hallId }).sort({ version: -1 }).select('version').lean();
    let layout;
    try {
      layout = await this.layouts.create({ venueId: venue._id, hallId, version: (latest?.version ?? 0) + 1, sections: input.sections });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new DomainException('LAYOUT_CONFLICT', 'Layout was changed concurrently, retry', HttpStatus.CONFLICT);
      }
      throw error;
    }
    await this.venues.updateOne({ _id: venue._id, 'halls.hallId': hallId }, { $set: { 'halls.$.layoutId': layout._id } });
    await this.audit.recordStandalone({
      actor: manager,
      action: 'layout.created',
      entity: 'venue',
      entityId: venueId,
      payload: { hallId, version: layout.version, totalSeats: layout.totalSeats },
    });
    return toLayoutDto(layout.toObject());
  }

  async getLayout(manager: AuthUser, venueId: string, hallId: string) {
    const venue = await this.ownedVenue(manager, venueId);
    const hall = venue.halls.find((h) => h.hallId === hallId);
    if (!hall?.layoutId) throw notFound('Layout');
    const layout = await this.layouts.findById(hall.layoutId).lean();
    if (!layout) throw notFound('Layout');
    return toLayoutDto(layout);
  }

  // ── Events ──────────────────────────────────────────────────────────────

  async createEvent(manager: AuthUser, input: CreateEvent) {
    const base = slugify(input.title);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${randomBytes(3).toString('hex')}`;
      try {
        const event = await this.events.create({ ...input, slug, managerId: manager.id, status: 'DRAFT' });
        await this.audit.recordStandalone({ actor: manager, action: 'event.created', entity: 'event', entityId: event.id as string });
        return toEventDto(event.toObject());
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
    throw new DomainException('SLUG_UNAVAILABLE', 'Could not generate a unique slug, change the title', HttpStatus.CONFLICT);
  }

  async listEvents(manager: AuthUser, page: Pagination) {
    const filter = { managerId: manager.id };
    const [rows, total] = await Promise.all([
      this.events
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page.page - 1) * page.limit)
        .limit(page.limit)
        .lean(),
      this.events.countDocuments(filter),
    ]);
    return pageOf(rows.map(toEventDto), total, page);
  }

  async getEvent(manager: AuthUser, eventId: string) {
    return toEventDto((await this.ownedEvent(manager, eventId)).toObject());
  }

  async updateEvent(manager: AuthUser, eventId: string, input: UpdateEvent) {
    const event = await this.ownedEvent(manager, eventId);
    if (event.status === 'CANCELLED') {
      throw new DomainException('EVENT_CANCELLED', 'A cancelled event cannot be edited', HttpStatus.CONFLICT);
    }
    event.set(input);
    await event.save();
    await this.cache.invalidateEvent(eventId);
    return toEventDto(event.toObject());
  }

  async publishEvent(manager: AuthUser, eventId: string) {
    const event = await this.ownedEvent(manager, eventId);
    if (event.status !== 'DRAFT') {
      throw new DomainException('EVENT_NOT_DRAFT', `Event is ${event.status}`, HttpStatus.CONFLICT);
    }
    event.status = 'PUBLISHED';
    await event.save();
    await this.cache.invalidateEvent(eventId);
    await this.audit.recordStandalone({ actor: manager, action: 'event.published', entity: 'event', entityId: eventId });
    return toEventDto(event.toObject());
  }

  // ── Shows ───────────────────────────────────────────────────────────────

  async createShow(manager: AuthUser, input: CreateShow) {
    const event = await this.ownedEvent(manager, input.eventId);
    if (event.status === 'CANCELLED') throw new DomainException('EVENT_CANCELLED', 'Event is cancelled', HttpStatus.CONFLICT);
    const venue = await this.ownedVenue(manager, input.venueId);
    if (venue.status !== 'ACTIVE') throw new DomainException('VENUE_INACTIVE', 'Venue is inactive', HttpStatus.CONFLICT);
    const hall = venue.halls.find((h) => h.hallId === input.hallId);
    if (!hall) throw notFound('Hall');
    if (!hall.layoutId) throw new DomainException('HALL_HAS_NO_LAYOUT', 'Define a seat layout for this hall first', HttpStatus.CONFLICT);
    const layout = await this.layouts.findById(hall.layoutId).lean();
    if (!layout) throw notFound('Layout');

    this.assertPricingCoversLayout(input.pricing, layout);
    const salesOpenAt = input.salesOpenAt ?? new Date();
    this.assertShowTimes(input.startsAt, input.endsAt, salesOpenAt);
    await this.assertHallFree(venue._id, input.hallId, input.startsAt, input.endsAt);

    const show = await this.shows.create({
      eventId: event._id,
      managerId: manager.id,
      venueId: venue._id,
      hallId: input.hallId,
      layoutId: layout._id,
      layoutVersion: layout.version,
      city: venue.city,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      salesOpenAt,
      pricing: input.pricing,
      currency: input.currency,
      status: 'SCHEDULED',
    });
    await this.audit.recordStandalone({ actor: manager, action: 'show.created', entity: 'show', entityId: show.id as string });
    return toShowDto(show.toObject());
  }

  async listShows(manager: AuthUser, query: ManagerShowsQuery) {
    const filter: Record<string, unknown> = { managerId: manager.id };
    if (query.eventId) filter['eventId'] = oid(query.eventId);
    if (query.status) filter['status'] = query.status;
    const [rows, total] = await Promise.all([
      this.shows
        .find(filter)
        .sort({ startsAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      this.shows.countDocuments(filter),
    ]);
    return pageOf(rows.map(toShowDto), total, query);
  }

  async getShow(manager: AuthUser, showId: string) {
    return toShowDto((await this.ownedShow(manager, showId)).toObject());
  }

  /** Only SCHEDULED shows can change times/pricing — once on sale, seats carry their prices. */
  async updateShow(manager: AuthUser, showId: string, input: UpdateShow) {
    const show = await this.ownedShow(manager, showId);
    if (show.status !== 'SCHEDULED') {
      throw new DomainException('SHOW_NOT_EDITABLE', `A ${show.status} show cannot be edited`, HttpStatus.CONFLICT);
    }
    const startsAt = input.startsAt ?? show.startsAt;
    const endsAt = input.endsAt ?? show.endsAt;
    const salesOpenAt = input.salesOpenAt ?? show.salesOpenAt;
    this.assertShowTimes(startsAt, endsAt, salesOpenAt);
    if (input.startsAt || input.endsAt) await this.assertHallFree(show.venueId, show.hallId, startsAt, endsAt, show._id);
    if (input.pricing) {
      const layout = await this.layouts.findById(show.layoutId).lean();
      if (!layout) throw notFound('Layout');
      this.assertPricingCoversLayout(input.pricing, layout);
    }
    show.set({ startsAt, endsAt, salesOpenAt, ...(input.pricing ? { pricing: input.pricing } : {}) });
    await show.save();
    await this.cache.invalidateShow(showId, show.eventId.toHexString());
    return toShowDto(show.toObject());
  }

  /**
   * SCHEDULED → ON_SALE. Materializes show_seats first (idempotent), then flips
   * the status, so a crash in between is repaired by publishing again.
   */
  async publishShow(manager: AuthUser, showId: string) {
    const show = await this.ownedShow(manager, showId);
    if (show.status !== 'SCHEDULED') {
      throw new DomainException('SHOW_NOT_SCHEDULED', `Show is already ${show.status}`, HttpStatus.CONFLICT);
    }
    if (show.startsAt <= new Date()) throw new DomainException('SHOW_IN_PAST', 'Show has already started', HttpStatus.CONFLICT);
    const event = await this.events.findById(show.eventId).lean();
    if (event?.status !== 'PUBLISHED') {
      throw new DomainException('EVENT_NOT_PUBLISHED', 'Publish the event before putting shows on sale', HttpStatus.CONFLICT);
    }
    const layout = await this.layouts.findById(show.layoutId).lean();
    if (!layout) throw notFound('Layout');

    const created = await this.inventory.materialize(
      { id: showId, eventId: show.eventId.toHexString(), pricing: show.pricing, currency: show.currency },
      layout,
    );
    show.status = 'ON_SALE';
    await show.save();
    await this.cache.invalidateShow(showId, show.eventId.toHexString());
    await this.audit.recordStandalone({
      actor: manager,
      action: 'show.published',
      entity: 'show',
      entityId: showId,
      payload: { seatsCreated: created, totalSeats: layout.totalSeats },
    });
    return { ...toShowDto(show.toObject()), totalSeats: layout.totalSeats };
  }

  async blockSeats(manager: AuthUser, showId: string, seatIds: string[], block: boolean) {
    const show = await this.ownedShow(manager, showId);
    if (show.status !== 'ON_SALE' && show.status !== 'SCHEDULED') {
      throw new DomainException('SHOW_NOT_ACTIVE', `Show is ${show.status}`, HttpStatus.CONFLICT);
    }
    const changed = block ? await this.inventory.block(showId, seatIds) : await this.inventory.unblock(showId, seatIds);
    await this.audit.recordStandalone({
      actor: manager,
      action: block ? 'seats.blocked' : 'seats.unblocked',
      entity: 'show',
      entityId: showId,
      payload: { seatIds: changed },
    });
    return { changed, skipped: seatIds.filter((id) => !changed.includes(id)) };
  }

  /** Used by the booking module (show cancellation): marks the show CANCELLED. Idempotent. */
  async markShowCancelled(manager: AuthUser, showId: string) {
    const show = await this.ownedShow(manager, showId);
    if (show.status === 'CANCELLED') return toShowDto(show.toObject());
    if (show.status === 'COMPLETED') {
      throw new DomainException('SHOW_NOT_CANCELLABLE', 'A completed show cannot be cancelled', HttpStatus.CONFLICT);
    }
    show.status = 'CANCELLED';
    await show.save();
    await this.cache.invalidateShow(showId, show.eventId.toHexString());
    return toShowDto(show.toObject());
  }

  /** Ids of the manager's shows (optionally only those starting in a range) — used by reports. */
  async ownedShowIds(manager: AuthUser, range?: { from?: Date; to?: Date }): Promise<string[]> {
    const filter: mongoose.QueryFilter<Show> = { managerId: manager.id };
    if (range?.from || range?.to) {
      filter.startsAt = mongoose.trusted({ ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lt: range.to } : {}) });
    }
    return (await this.shows.find(filter).select('_id').lean()).map((s) => s._id.toHexString());
  }

  // ── Ownership & rules ─────────────────────────────────────────────────

  async ownedShow(manager: AuthUser, showId: string) {
    const show = await this.shows.findOne({ _id: oid(showId), managerId: manager.id });
    if (!show) throw notFound('Show');
    return show;
  }

  private async ownedVenue(manager: AuthUser, venueId: string) {
    const venue = await this.venues.findOne({ _id: oid(venueId), managerId: manager.id });
    if (!venue) throw notFound('Venue');
    return venue;
  }

  private async ownedEvent(manager: AuthUser, eventId: string) {
    const event = await this.events.findOne({ _id: oid(eventId), managerId: manager.id });
    if (!event) throw notFound('Event');
    return event;
  }

  private assertPricingCoversLayout(pricing: Record<string, number>, layout: Pick<SeatLayout, 'sections'>) {
    const tiers = new Set(layout.sections.map((s) => s.priceTier));
    const missing = [...tiers].filter((tier) => pricing[tier] === undefined);
    const unknown = Object.keys(pricing).filter((tier) => !tiers.has(tier));
    if (missing.length > 0 || unknown.length > 0) {
      throw new DomainException('PRICING_MISMATCH', 'Pricing must cover exactly the layout price tiers', HttpStatus.BAD_REQUEST, {
        missing,
        unknown,
      });
    }
  }

  private assertShowTimes(startsAt: Date, endsAt: Date, salesOpenAt: Date) {
    if (startsAt <= new Date()) throw new DomainException('SHOW_IN_PAST', 'startsAt must be in the future');
    if (endsAt <= startsAt) throw new DomainException('INVALID_SHOW_TIMES', 'endsAt must be after startsAt');
    if (salesOpenAt >= startsAt) throw new DomainException('INVALID_SHOW_TIMES', 'salesOpenAt must be before startsAt');
  }

  private async assertHallFree(venueId: Types.ObjectId, hallId: string, startsAt: Date, endsAt: Date, exceptId?: Types.ObjectId) {
    const clash = await this.shows.exists({
      venueId,
      hallId,
      status: mongoose.trusted({ $ne: 'CANCELLED' }),
      startsAt: mongoose.trusted({ $lt: endsAt }),
      endsAt: mongoose.trusted({ $gt: startsAt }),
      ...(exceptId ? { _id: mongoose.trusted({ $ne: exceptId }) } : {}),
    });
    if (clash) throw new DomainException('HALL_BUSY', 'Another show overlaps this time in the same hall', HttpStatus.CONFLICT);
  }
}
