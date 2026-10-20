import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  BookingPage,
  BookingResponse,
  CancelShowResponse,
  SalesReportResponse,
  ShowBookingPage,
  TicketResponse,
  TicketVerificationResponse,
} from './dto/booking.responses.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators.js';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard.js';
import { ApiZodBody, ApiZodResponse, ApiZodQuery, ObjectIdSchema, UuidSchema, zodPipe } from '../../common/validation/zod.js';
import { BookingService } from './booking.service.js';
import {
  HoldSeatsSchema,
  ListBookingsQuerySchema,
  SalesReportQuerySchema,
  ShowBookingsQuerySchema,
  VerifyTicketSchema,
  type HoldSeats,
  type ListBookingsQuery,
  type SalesReportQuery,
  type ShowBookingsQuery,
  type VerifyTicket,
} from './dto/booking.dto.js';
import { ReportsService } from './reports.service.js';

@ApiTags('bookings')
@ApiBearerAuth()
@Roles('CUSTOMER')
@Controller('bookings')
export class BookingController {
  constructor(private readonly bookings: BookingService) {}

  @Post('hold')
  @Idempotent()
  @RateLimit({ scope: 'hold', limit: 20, windowSeconds: 60, by: 'user' })
  @ApiOperation({
    summary: 'Hold seats for a show (expires after the hold TTL unless paid)',
  })
  @ApiZodBody(HoldSeatsSchema)
  @ApiZodResponse(201, BookingResponse)
  hold(@CurrentUser() customer: AuthUser, @Body(zodPipe(HoldSeatsSchema)) body: HoldSeats) {
    return this.bookings.hold(customer, body);
  }

  @Delete(':id/hold')
  @HttpCode(204)
  @ApiOperation({ summary: 'Release a hold before paying' })
  async release(@CurrentUser() customer: AuthUser, @Param('id', zodPipe(UuidSchema)) id: string): Promise<void> {
    await this.bookings.release(customer, id);
  }

  @Get()
  @ApiZodQuery(ListBookingsQuerySchema)
  @ApiZodResponse(200, BookingPage)
  list(@CurrentUser() customer: AuthUser, @Query(zodPipe(ListBookingsQuerySchema)) query: ListBookingsQuery) {
    return this.bookings.list(customer, query);
  }

  @Get(':id')
  @ApiZodResponse(200, BookingResponse)
  get(@CurrentUser() customer: AuthUser, @Param('id', zodPipe(UuidSchema)) id: string) {
    return this.bookings.get(customer, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({
    summary: 'Cancel a confirmed booking (refund minus fee, before the cut-off)',
  })
  @ApiZodResponse(200, BookingResponse)
  cancel(@CurrentUser() customer: AuthUser, @Param('id', zodPipe(UuidSchema)) id: string) {
    return this.bookings.cancel(customer, id);
  }

  @Get(':id/ticket')
  @ApiOperation({ summary: 'Ticket with signed QR code (confirmed bookings)' })
  @ApiZodResponse(200, TicketResponse)
  ticket(@CurrentUser() customer: AuthUser, @Param('id', zodPipe(UuidSchema)) id: string) {
    return this.bookings.ticket(customer, id);
  }
}

@ApiTags('manager · bookings')
@ApiBearerAuth()
@Roles('MANAGER')
@Controller('manager')
export class ManagerBookingController {
  constructor(
    private readonly bookings: BookingService,
    private readonly reports: ReportsService,
  ) {}

  @Get('shows/:id/bookings')
  @ApiZodQuery(ShowBookingsQuerySchema)
  @ApiZodResponse(200, ShowBookingPage)
  showBookings(
    @CurrentUser() m: AuthUser,
    @Param('id', zodPipe(ObjectIdSchema)) id: string,
    @Query(zodPipe(ShowBookingsQuerySchema)) query: ShowBookingsQuery,
  ) {
    return this.bookings.showBookings(m, id, query);
  }

  @Post('shows/:id/cancel')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Cancel a show: seats blocked now; every booking is cancelled with a full refund in the background (idempotent)',
  })
  @ApiZodResponse(202, CancelShowResponse)
  cancelShow(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string) {
    return this.bookings.cancelShow(m, id);
  }

  @Post('tickets/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate a ticket QR code at the door' })
  @ApiZodBody(VerifyTicketSchema)
  @ApiZodResponse(200, TicketVerificationResponse)
  verifyTicket(@CurrentUser() m: AuthUser, @Body(zodPipe(VerifyTicketSchema)) body: VerifyTicket) {
    return this.bookings.verifyTicket(m, body.code);
  }

  @Get('reports/sales')
  @ApiOperation({
    summary: 'Sales and occupancy per show (shows starting in [from, to))',
  })
  @ApiZodQuery(SalesReportQuerySchema)
  @ApiZodResponse(200, SalesReportResponse)
  sales(@CurrentUser() m: AuthUser, @Query(zodPipe(SalesReportQuerySchema)) query: SalesReportQuery) {
    return this.reports.sales(m, query);
  }
}
