import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { maxItems, requireSaveForFields } from './common.js';

export const SEAT_TYPES = ['REGULAR', 'RECLINER', 'WHEELCHAIR', 'GAP'] as const;
export type SeatType = (typeof SEAT_TYPES)[number];

@Schema({ _id: false })
export class LayoutSeat {
  /** Unique within the layout, e.g. "A12". Becomes show_seats.seat_id. */
  @Prop({ type: String, required: true, match: /^[A-Z0-9-]{1,16}$/ })
  id: string;

  @Prop({ type: Number, required: true, min: 1 })
  number: number;

  /** Grid position for rendering the seat map */
  @Prop({ type: Number, required: true, min: 0 })
  x: number;

  @Prop({ type: Number, required: true, min: 0 })
  y: number;

  /** GAP = aisle/empty cell: rendered as space, never sold */
  @Prop({ type: String, enum: SEAT_TYPES, default: 'REGULAR' })
  type: SeatType;
}
const LayoutSeatSchema = SchemaFactory.createForClass(LayoutSeat);

@Schema({ _id: false })
export class LayoutRow {
  @Prop({ type: String, required: true, match: /^[A-Z]{1,3}$/ })
  label: string;

  @Prop({ type: [LayoutSeatSchema], required: true, validate: maxItems(200, 'row seats') })
  seats: LayoutSeat[];
}
const LayoutRowSchema = SchemaFactory.createForClass(LayoutRow);

@Schema({ _id: false })
export class LayoutSection {
  /** e.g. "GOLD" */
  @Prop({ type: String, required: true, match: /^[A-Z0-9_]{1,32}$/ })
  code: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 64 })
  name: string;

  /** Key into shows.pricing */
  @Prop({ type: String, required: true, match: /^[A-Z0-9_]{1,32}$/ })
  priceTier: string;

  @Prop({ type: [LayoutRowSchema], required: true, validate: maxItems(100, 'section rows') })
  rows: LayoutRow[];
}
const LayoutSectionSchema = SchemaFactory.createForClass(LayoutSection);

/**
 * Seat layout of one hall. Layouts are immutable once a show using them is on
 * sale — edits create a new `version` document.
 */
@Schema({ collection: 'seat_layouts', timestamps: true })
export class SeatLayout {
  @Prop({ type: Types.ObjectId, ref: 'Venue', required: true })
  venueId: Types.ObjectId;

  @Prop({ type: String, required: true, match: /^[a-z0-9-]{1,32}$/ })
  hallId: string;

  @Prop({ type: Number, required: true, min: 1, default: 1 })
  version: number;

  @Prop({ type: [LayoutSectionSchema], required: true, validate: maxItems(20, 'sections') })
  sections: LayoutSection[];

  /** Number of sellable seats (excludes GAP). Computed on validate — never set by clients. */
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  totalSeats: number;
}

export type SeatLayoutDocument = HydratedDocument<SeatLayout>;
export const SeatLayoutSchema = SchemaFactory.createForClass(SeatLayout);

SeatLayoutSchema.index({ venueId: 1, hallId: 1, version: -1 }, { unique: true });

/** Sellable seats of a layout, flattened — used to materialize show_seats. */
export function sellableSeats(layout: Pick<SeatLayout, 'sections'>) {
  return layout.sections.flatMap((section) =>
    section.rows.flatMap((row) =>
      row.seats
        .filter((seat) => seat.type !== 'GAP')
        .map((seat) => ({
          seatId: seat.id,
          section: section.code,
          rowLabel: row.label,
          seatNumber: seat.number,
          priceTier: section.priceTier,
        })),
    ),
  );
}

// Layouts are immutable once used; edits create a new version via save().
requireSaveForFields(SeatLayoutSchema, ['sections', 'totalSeats', 'version']);

SeatLayoutSchema.pre('validate', function () {
  const seatIds = new Set<string>();
  const sectionCodes = new Set<string>();
  const positions = new Set<string>();

  for (const section of this.sections) {
    if (sectionCodes.has(section.code)) {
      this.invalidate('sections', `duplicate section code "${section.code}"`);
    }
    sectionCodes.add(section.code);

    for (const row of section.rows) {
      for (const seat of row.seats) {
        if (seatIds.has(seat.id)) {
          this.invalidate('sections', `duplicate seat id "${seat.id}"`);
        }
        seatIds.add(seat.id);

        const position = `${seat.x},${seat.y}`;
        if (positions.has(position)) {
          this.invalidate('sections', `two seats share grid position (${position})`);
        }
        positions.add(position);
      }
    }
  }

  this.totalSeats = sellableSeats(this).length;
  if (this.totalSeats === 0) {
    this.invalidate('sections', 'layout must contain at least one sellable seat');
  }
});
