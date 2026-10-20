import type { Schema } from 'mongoose';

/** users.id in PostgreSQL (UUID, lower-case). */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Array length validator — the model is the last line of defence behind the DTOs. */
export const maxItems = (max: number, label: string) => ({
  validator: (items: unknown[]) => items.length <= max,
  message: `${label} may contain at most ${max} items`,
});

/** Which of `fields` a Mongo update document (operators or plain replacement) would modify. */
export function fieldsTouchedByUpdate(update: unknown, fields: readonly string[]): string[] {
  if (update === null || typeof update !== 'object') return [];
  const paths = Object.entries(update as Record<string, unknown>).flatMap(([key, value]) =>
    key.startsWith('$') && value !== null && typeof value === 'object' ? Object.keys(value) : [key],
  );
  return fields.filter((field) => paths.some((path) => path === field || path.startsWith(`${field}.`)));
}

/**
 * Cross-field rules live in `pre('validate')` document hooks, which Mongoose
 * does not run for query updates. Block query updates that touch those fields
 * so they must go through load → mutate → save().
 */
export function requireSaveForFields(schema: Schema, fields: readonly string[]): void {
  for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'] as const) {
    schema.pre(op, function () {
      const blocked = fieldsTouchedByUpdate(this.getUpdate(), fields);
      if (blocked.length > 0) {
        throw new Error(`Update ${blocked.join(', ')} via document.save() so cross-field validation runs`);
      }
    });
  }
}
