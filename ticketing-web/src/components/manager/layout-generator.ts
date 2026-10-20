import type { Layout, LayoutInput, SeatType } from '@/lib/api/types';

/**
 * Pure model behind the seat layout builder. A manager describes sections as "N rows × M seats";
 * this module turns that into the API's PUT layout body:
 * - row labels continue across sections (A, B … Z, AA, AB …) so every label — and therefore every
 *   seat id `${row}${number}` — is unique in the hall;
 * - x / y are integers in 0–1000 laid out front (y = 0) to back, narrower sections centred;
 * - per-seat type overrides (recliner, wheelchair, gap) are keyed by row index + seat number so they
 *   survive renaming a section.
 */

export const LIMITS = { sections: 20, rowsPerSection: 100, seatsPerRow: 200 } as const;
export const SEAT_TYPE_CYCLE: SeatType[] = ['REGULAR', 'RECLINER', 'WHEELCHAIR', 'GAP'];
export const CODE_PATTERN = /^[A-Z0-9_]{1,32}$/;

export interface SectionDraft {
  key: string;
  code: string;
  name: string;
  priceTier: string;
  rows: number;
  seatsPerRow: number;
  /** `${rowIndex}:${seatNumber}` → type, only for non-REGULAR seats */
  overrides: Record<string, SeatType>;
}

export interface BuiltSeat {
  id: string;
  number: number;
  x: number;
  y: number;
  type: SeatType;
  /** grid position used by the preview */
  column: number;
  overrideKey: string;
}
export interface BuiltRow {
  label: string;
  rowIndex: number;
  line: number;
  seats: BuiltSeat[];
}
export interface BuiltSection {
  key: string;
  code: string;
  name: string;
  priceTier: string;
  rows: BuiltRow[];
}
export interface BuiltLayout {
  sections: BuiltSection[];
  columns: number;
  lines: number;
  seatCount: number;
}

/** 0 → "A", 25 → "Z", 26 → "AA", 701 → "ZZ", 702 → "AAA" (bijective base-26). */
export function rowLabel(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export const overrideKey = (rowIndex: number, seatNumber: number) => `${rowIndex}:${seatNumber}`;

export function nextSeatType(type: SeatType): SeatType {
  const index = SEAT_TYPE_CYCLE.indexOf(type);
  return SEAT_TYPE_CYCLE[(index + 1) % SEAT_TYPE_CYCLE.length] ?? 'REGULAR';
}

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));

export function buildLayout(drafts: SectionDraft[]): BuiltLayout {
  const columns = Math.max(1, ...drafts.map((draft) => clampInt(draft.seatsPerRow, 1, LIMITS.seatsPerRow)));
  // One empty line between sections (an aisle) in the coordinate space.
  const totalRows = drafts.reduce((sum, draft) => sum + clampInt(draft.rows, 1, LIMITS.rowsPerSection), 0);
  const lines = Math.max(1, totalRows + Math.max(0, drafts.length - 1));
  const toCoord = (position: number, count: number) => (count <= 1 ? 0 : Math.round((position / (count - 1)) * 1000));

  let labelIndex = 0;
  let line = 0;
  let seatCount = 0;
  const sections = drafts.map((draft, sectionIndex): BuiltSection => {
    if (sectionIndex > 0) line += 1;
    const rowCount = clampInt(draft.rows, 1, LIMITS.rowsPerSection);
    const seatsPerRow = clampInt(draft.seatsPerRow, 1, LIMITS.seatsPerRow);
    const offset = Math.floor((columns - seatsPerRow) / 2);
    const rows: BuiltRow[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const label = rowLabel(labelIndex);
      labelIndex += 1;
      const seats: BuiltSeat[] = [];
      for (let number = 1; number <= seatsPerRow; number += 1) {
        const key = overrideKey(rowIndex, number);
        const type = draft.overrides[key] ?? 'REGULAR';
        const column = offset + number - 1;
        if (type !== 'GAP') seatCount += 1;
        seats.push({
          id: `${label}${number}`,
          number,
          type,
          column,
          overrideKey: key,
          x: toCoord(column, columns),
          y: toCoord(line, lines),
        });
      }
      rows.push({ label, rowIndex, line, seats });
      line += 1;
    }
    return { key: draft.key, code: draft.code.trim(), name: draft.name.trim(), priceTier: draft.priceTier.trim(), rows };
  });
  return { sections, columns, lines, seatCount };
}

export function toLayoutInput(built: BuiltLayout): LayoutInput {
  return {
    sections: built.sections.map((section) => ({
      code: section.code,
      name: section.name,
      priceTier: section.priceTier,
      rows: section.rows.map((row) => ({
        label: row.label,
        seats: row.seats.map(({ id, number, x, y, type }) => ({ id, number, x, y, type })),
      })),
    })),
  };
}

/** Problems that would make the API reject the layout, in plain language. */
export function validateDrafts(drafts: SectionDraft[]): string[] {
  const problems: string[] = [];
  if (drafts.length === 0) problems.push('Add at least one section.');
  if (drafts.length > LIMITS.sections) problems.push(`Use at most ${LIMITS.sections} sections.`);
  const codes = new Set<string>();
  drafts.forEach((draft, index) => {
    const label = draft.name.trim() || `Section ${index + 1}`;
    if (!CODE_PATTERN.test(draft.code.trim())) problems.push(`${label}: code must be UPPER_SNAKE (A–Z, 0–9, _), max 32 characters.`);
    if (!CODE_PATTERN.test(draft.priceTier.trim()))
      problems.push(`${label}: price tier must be UPPER_SNAKE (A–Z, 0–9, _), max 32 characters.`);
    if (draft.name.trim().length === 0 || draft.name.trim().length > 64)
      problems.push(`Section ${index + 1}: name must be 1–64 characters.`);
    if (!Number.isInteger(draft.rows) || draft.rows < 1 || draft.rows > LIMITS.rowsPerSection)
      problems.push(`${label}: rows must be between 1 and ${LIMITS.rowsPerSection}.`);
    if (!Number.isInteger(draft.seatsPerRow) || draft.seatsPerRow < 1 || draft.seatsPerRow > LIMITS.seatsPerRow)
      problems.push(`${label}: seats per row must be between 1 and ${LIMITS.seatsPerRow}.`);
    const code = draft.code.trim();
    if (codes.has(code)) problems.push(`Section code "${code}" is used twice.`);
    codes.add(code);
  });
  if (drafts.length > 0 && buildLayout(drafts).seatCount === 0) problems.push('The layout has no bookable seats.');
  return problems;
}

let keySeed = 0;
export const newSectionKey = () => `section-${Date.now().toString(36)}-${(keySeed += 1)}`;

export function newSection(existing: SectionDraft[]): SectionDraft {
  const n = existing.length + 1;
  return {
    key: newSectionKey(),
    code: `SECTION_${n}`,
    name: `Section ${n}`,
    priceTier: n === 1 ? 'STANDARD' : `TIER_${n}`,
    rows: 5,
    seatsPerRow: 10,
    overrides: {},
  };
}

/** Rebuilds drafts from a saved layout (row labels are re-assigned in sequence on save). */
export function layoutToDrafts(layout: Layout): SectionDraft[] {
  return layout.sections.map((section) => {
    const overrides: Record<string, SeatType> = {};
    section.rows.forEach((row, rowIndex) => {
      for (const seat of row.seats) if (seat.type !== 'REGULAR') overrides[overrideKey(rowIndex, seat.number)] = seat.type;
    });
    return {
      key: newSectionKey(),
      code: section.code,
      name: section.name,
      priceTier: section.priceTier,
      rows: Math.max(1, section.rows.length),
      seatsPerRow: Math.max(1, ...section.rows.map((row) => Math.max(row.seats.length, ...row.seats.map((seat) => seat.number)))),
      overrides,
    };
  });
}

/** Distinct price tiers of a layout, in section order (used to ask for show pricing). */
export function priceTiersOf(layout: Pick<Layout, 'sections'>): string[] {
  return [...new Set(layout.sections.map((section) => section.priceTier))];
}
