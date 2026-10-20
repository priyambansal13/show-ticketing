import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UUID_PATTERN } from './common.js';

export const VENUE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];

@Schema({ _id: false })
export class Address {
  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  line1: string;

  @Prop({ type: String, trim: true, maxlength: 200 })
  line2?: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  state: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 12 })
  postalCode: string;

  @Prop({ type: String, required: true, trim: true, uppercase: true, minlength: 2, maxlength: 2, default: 'IN' })
  country: string;
}
const AddressSchema = SchemaFactory.createForClass(Address);

@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point', required: true })
  type: 'Point';

  /** [longitude, latitude] — GeoJSON order */
  @Prop({
    type: [Number],
    required: true,
    validate: {
      validator: (c: number[]) => c.length === 2 && c[0]! >= -180 && c[0]! <= 180 && c[1]! >= -90 && c[1]! <= 90,
      message: 'coordinates must be [lng, lat]',
    },
  })
  coordinates: [number, number];
}
const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

@Schema({ _id: false })
export class Hall {
  /** Stable id within the venue, e.g. "audi-1" */
  @Prop({ type: String, required: true, trim: true, match: /^[a-z0-9-]{1,32}$/ })
  hallId: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name: string;

  /** Current seat layout for this hall (latest version) */
  @Prop({ type: Types.ObjectId, ref: 'SeatLayout' })
  layoutId?: Types.ObjectId;
}
const HallSchema = SchemaFactory.createForClass(Hall);

@Schema({ collection: 'venues', timestamps: true })
export class Venue {
  /** Owning manager — users.id (uuid) in PostgreSQL */
  @Prop({ type: String, required: true, index: true, match: UUID_PATTERN })
  managerId: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  name: string;

  /** Lower-case city slug used for browsing, e.g. "bengaluru" */
  @Prop({ type: String, required: true, trim: true, lowercase: true, match: /^[a-z-]{2,64}$/ })
  city: string;

  @Prop({ type: AddressSchema, required: true })
  address: Address;

  @Prop({ type: GeoPointSchema })
  geo?: GeoPoint;

  @Prop({
    type: [HallSchema],
    default: [],
    validate: {
      validator: (halls: Hall[]) => halls.length <= 50 && new Set(halls.map((h) => h.hallId)).size === halls.length,
      message: 'hallId must be unique within a venue (max 50 halls)',
    },
  })
  halls: Hall[];

  @Prop({ type: String, enum: VENUE_STATUSES, default: 'ACTIVE' })
  status: VenueStatus;
}

export type VenueDocument = HydratedDocument<Venue>;
export const VenueSchema = SchemaFactory.createForClass(Venue);

VenueSchema.index({ city: 1, status: 1 });
VenueSchema.index({ geo: '2dsphere' }, { sparse: true });
