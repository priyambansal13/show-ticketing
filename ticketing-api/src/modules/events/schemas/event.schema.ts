import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { maxItems, UUID_PATTERN } from './common.js';

export const EVENT_CATEGORIES = ['MOVIE', 'CONCERT', 'SPORTS', 'PLAY', 'COMEDY'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

const HTTPS_URL = /^https:\/\/\S+$/;

@Schema({ _id: false })
export class CastMember {
  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ type: String, trim: true, maxlength: 120 })
  role?: string;
}
const CastMemberSchema = SchemaFactory.createForClass(CastMember);

@Schema({ collection: 'events', timestamps: true })
export class Event {
  /** Owning manager — users.id (uuid) in PostgreSQL */
  @Prop({ type: String, required: true, match: UUID_PATTERN })
  managerId: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  title: string;

  @Prop({ type: String, required: true, unique: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxlength: 220 })
  slug: string;

  /** Plain text / sanitized markdown — never rendered as raw HTML */
  @Prop({ type: String, required: true, maxlength: 5000 })
  description: string;

  @Prop({ type: String, enum: EVENT_CATEGORIES, required: true })
  category: EventCategory;

  @Prop({ type: String, trim: true, maxlength: 40 })
  language?: string;

  @Prop({ type: [{ type: String, trim: true, lowercase: true, maxlength: 40 }], default: [], validate: maxItems(10, 'genres') })
  genres: string[];

  @Prop({ type: Number, required: true, min: 1, max: 24 * 60 })
  durationMins: number;

  @Prop({ type: String, match: HTTPS_URL })
  posterUrl?: string;

  @Prop({ type: String, match: HTTPS_URL })
  bannerUrl?: string;

  @Prop({ type: [CastMemberSchema], default: [], validate: maxItems(50, 'cast') })
  cast: CastMember[];

  /** e.g. "U", "UA", "A", "18+" */
  @Prop({ type: String, trim: true, maxlength: 8 })
  ageRating?: string;

  @Prop({ type: String, enum: EVENT_STATUSES, default: 'DRAFT' })
  status: EventStatus;
}

export type EventDocument = HydratedDocument<Event>;
export const EventSchema = SchemaFactory.createForClass(Event);

EventSchema.index({ managerId: 1, status: 1 });
EventSchema.index({ status: 1, category: 1 });
EventSchema.index({ title: 'text', genres: 'text' }, { weights: { title: 5, genres: 1 }, name: 'event_text_search' });
