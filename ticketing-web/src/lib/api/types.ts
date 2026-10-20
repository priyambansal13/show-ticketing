/**
 * Named aliases over the generated OpenAPI types (`pnpm gen:api` → schema.d.ts).
 * Never hand-write API shapes here — only pick them out of `paths`.
 */
import type { paths } from './schema';

type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;
type Ok<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends { responses: infer R }
  ? Json<R[200 & keyof R]> | Json<R[201 & keyof R]> | Json<R[202 & keyof R]>
  : never;
export type Body<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;
type Query<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends { parameters: { query?: infer Q } }
  ? NonNullable<Q>
  : never;

export type Portal = 'customer' | 'manager' | 'admin';
export type AuthResult = Ok<'/api/v1/auth/{portal}/login', 'post'>;
export type User = Ok<'/api/v1/auth/me', 'get'>;
export type Role = User['role'];
export type UserStatus = User['status'];
export type CustomerRegistration = Body<'/api/v1/auth/customer/register', 'post'>;
export type ManagerRegistration = Body<'/api/v1/auth/manager/register', 'post'>;
export type Credentials = Body<'/api/v1/auth/{portal}/login', 'post'>;

// Public catalog
export type EventPage = Ok<'/api/v1/events', 'get'>;
export type CatalogEvent = EventPage['data'][number];
export type EventCategory = CatalogEvent['category'];
export type BrowseQuery = Query<'/api/v1/events', 'get'>;
export type EventShow = Ok<'/api/v1/events/{id}/shows', 'get'>[number];
export type ShowDetail = Ok<'/api/v1/shows/{id}', 'get'>;
export type SeatMap = Ok<'/api/v1/shows/{id}/seats', 'get'>;
export type SeatMapSection = SeatMap['sections'][number];
export type SeatMapSeat = SeatMapSection['rows'][number]['seats'][number];

// Customer bookings & payments
export type Booking = Ok<'/api/v1/bookings/{id}', 'get'>;
export type BookingStatus = Booking['status'];
export type BookingPage = Ok<'/api/v1/bookings', 'get'>;
export type Ticket = Ok<'/api/v1/bookings/{id}/ticket', 'get'>;
export type PaymentOrder = Ok<'/api/v1/payments/initiate', 'post'>;
export type PaymentVerification = Ok<'/api/v1/payments/verify', 'post'>;
export type CheckoutConfirmation = Ok<'/api/v1/payments/fake/complete', 'post'>;

// Manager
export type Venue = Ok<'/api/v1/manager/venues/{id}', 'get'>;
export type VenuePage = Ok<'/api/v1/manager/venues', 'get'>;
export type VenueInput = Body<'/api/v1/manager/venues', 'post'>;
export type VenueUpdate = Body<'/api/v1/manager/venues/{id}', 'patch'>;
export type HallInput = Body<'/api/v1/manager/venues/{id}/halls', 'post'>;
export type Layout = Ok<'/api/v1/manager/venues/{id}/halls/{hallId}/layout', 'get'>;
export type LayoutInput = Body<'/api/v1/manager/venues/{id}/halls/{hallId}/layout', 'put'>;
export type SeatType = Layout['sections'][number]['rows'][number]['seats'][number]['type'];
export type ManagerEvent = Ok<'/api/v1/manager/events/{id}', 'get'>;
export type ManagerEventPage = Ok<'/api/v1/manager/events', 'get'>;
export type EventInput = Body<'/api/v1/manager/events', 'post'>;
export type EventUpdate = Body<'/api/v1/manager/events/{id}', 'patch'>;
export type ManagerShow = Ok<'/api/v1/manager/shows/{id}', 'get'>;
export type ManagerShowPage = Ok<'/api/v1/manager/shows', 'get'>;
export type ManagerShowsQuery = Query<'/api/v1/manager/shows', 'get'>;
export type ShowStatus = ManagerShow['status'];
export type ShowInput = Body<'/api/v1/manager/shows', 'post'>;
export type ShowUpdate = Body<'/api/v1/manager/shows/{id}', 'patch'>;
export type SeatChangeResult = Ok<'/api/v1/manager/shows/{id}/seats/block', 'post'>;
export type ShowBookingPage = Ok<'/api/v1/manager/shows/{id}/bookings', 'get'>;
export type ShowBooking = ShowBookingPage['data'][number];
export type CancelShowResult = Ok<'/api/v1/manager/shows/{id}/cancel', 'post'>;
export type TicketVerification = Ok<'/api/v1/manager/tickets/verify', 'post'>;
export type SalesReport = Ok<'/api/v1/manager/reports/sales', 'get'>;
export type SalesQuery = Query<'/api/v1/manager/reports/sales', 'get'>;

// Admin
export type ManagerAccountPage = Ok<'/api/v1/admin/managers', 'get'>;
export type ManagerAccount = ManagerAccountPage['data'][number];

/** Every API error uses this envelope (see CLAUDE.md conventions). */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}
