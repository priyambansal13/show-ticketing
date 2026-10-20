import mongoose from 'mongoose';

/**
 * Process-wide Mongoose safety settings. Must be applied before any connection
 * or model is created (MongoModule, seed script, tests all call this).
 *
 * Note: `sanitizeFilter` passed as a *connection* option is silently ignored by
 * Mongoose 9 — only the global setting protects queries. Covered by
 * test/integration/mongo-catalog.int-spec.ts.
 */
export function applyMongooseSecurityDefaults(): void {
  // Wraps nested `$`-operator objects in user-supplied filters in `$eq`, so
  // `{ slug: { $ne: null } }` from a request body cannot match every document
  // (security-standards A03 — query selector injection).
  mongoose.set('sanitizeFilter', true);
  // Filter paths not declared in the schema are dropped instead of being sent to MongoDB.
  mongoose.set('strictQuery', true);
}
