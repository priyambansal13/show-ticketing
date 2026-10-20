import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { requireSaveForFields, UUID_PATTERN } from './common.js';

export const SHOW_STATUSES = ['SCHEDULED', 'ON_SALE', 'CANCELLED', 'COMPLETED'] as const;
export type ShowStatus = (typeof SHOW_STATUSES)[number];

/**
 * One scheduled performance of an event in a hall.
 * `pricing` is configuration only; the authoritative price of each seat is
 * show_seats.price in PostgreSQL, copied from here when the show is published.
 */
@Schema({ collection: 'shows', timestamps: true })
export class Show {
  @Prop({ type: Types.ObjectId, ref: 'Event', required: true })
  eventId: Types.ObjectId;

  /** Owning manager — users.id (uuid) in PostgreSQL */
  @Prop({ type: String, required: true, match: UUID_PATTERN })
  managerId: string;

  @Prop({ type: Types.ObjectId, ref: 'Venue', required: true })
  venueId: Types.ObjectId;

  @Prop({ type: String, required: true, match: /^[a-z0-9-]{1,32}$/ })
  hallId: string;

  @Prop({ type: Types.ObjectId, ref: 'SeatLayout', required: true })
  layoutId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  layoutVersion: number;

  /** Denormalized from the venue for city browsing */
  @Prop({ type: String, required: true, lowercase: true, match: /^[a-z-]{2,64}$/ })
  city: string;

  @Prop({ type: Date, required: true })
  startsAt: Date;

  @Prop({ type: Date, required: true })
  endsAt: Date;

  @Prop({ type: Date, required: true })
  salesOpenAt: Date;

  /** priceTier → price in minor units (paise). Positive integers only — no floating-point money, no free seats. */
  @Prop({
    type: Map,
    of: Number,
    required: true,
    validate: {
      validator: (pricing: Map<string, number>) =>
        pricing.size > 0 && pricing.size <= 20 && [...pricing.values()].every((p) => Number.isSafeInteger(p) && p > 0),
      message: 'pricing must map 1–20 tiers to a positive integer amount in minor units',
    },
  })
  pricing: Map<string, number>;

  @Prop({ type: String, required: true, default: 'INR', match: /^[A-Z]{3}$/ })
  currency: string;

  @Prop({ type: String, enum: SHOW_STATUSES, default: 'SCHEDULED' })
  status: ShowStatus;
}

export type ShowDocument = HydratedDocument<Show>;
export const ShowSchema = SchemaFactory.createForClass(Show);

// ESR order (equality, sort, range): city = ? AND status = ? AND startsAt BETWEEN …
ShowSchema.index({ city: 1, status: 1, startsAt: 1 });
ShowSchema.index({ eventId: 1, startsAt: 1 });
ShowSchema.index({ managerId: 1, startsAt: -1 });
ShowSchema.index({ venueId: 1, hallId: 1, startsAt: 1 });

requireSaveForFields(ShowSchema, ['startsAt', 'endsAt', 'salesOpenAt', 'layoutId', 'layoutVersion', 'pricing']);

ShowSchema.pre('validate', function () {
  if (this.endsAt <= this.startsAt) {
    this.invalidate('endsAt', 'endsAt must be after startsAt');
  }
  if (this.salesOpenAt >= this.startsAt) {
    this.invalidate('salesOpenAt', 'salesOpenAt must be before startsAt');
  }
});
