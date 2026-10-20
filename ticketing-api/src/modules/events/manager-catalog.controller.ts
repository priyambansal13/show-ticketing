import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  BlockSeatsResponse,
  EventPage,
  EventResponse,
  LayoutResponse,
  PublishedShowResponse,
  ShowPage,
  ShowResponse,
  VenuePage,
  VenueResponse,
} from './dto/catalog.responses.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '../../common/auth/auth.decorators.js';
import {
  ApiZodBody,
  ApiZodResponse,
  ApiZodQuery,
  ObjectIdSchema,
  PaginationSchema,
  zodPipe,
  type Pagination,
} from '../../common/validation/zod.js';
import {
  AddHallSchema,
  CreateEventSchema,
  CreateShowSchema,
  CreateVenueSchema,
  ManagerShowsQuerySchema,
  PutLayoutSchema,
  SeatIdsSchema,
  UpdateEventSchema,
  UpdateShowSchema,
  UpdateVenueSchema,
  type AddHall,
  type CreateEvent,
  type CreateShow,
  type CreateVenue,
  type ManagerShowsQuery,
  type PutLayout,
  type SeatIds,
  type UpdateEvent,
  type UpdateShow,
  type UpdateVenue,
} from './dto/catalog.dto.js';
import { ManagerCatalogService } from './manager-catalog.service.js';

const HallIdPipe = zodPipe(AddHallSchema.shape.hallId);

@ApiTags('manager · catalog')
@ApiBearerAuth()
@Roles('MANAGER')
@Controller('manager')
export class ManagerCatalogController {
  constructor(private readonly catalog: ManagerCatalogService) {}

  // ── Venues ──
  @Post('venues')
  @ApiOperation({ summary: 'Create a venue (optionally with halls)' })
  @ApiZodBody(CreateVenueSchema)
  @ApiZodResponse(201, VenueResponse)
  createVenue(@CurrentUser() m: AuthUser, @Body(zodPipe(CreateVenueSchema)) body: CreateVenue) {
    return this.catalog.createVenue(m, body);
  }

  @Get('venues')
  @ApiZodQuery(PaginationSchema)
  @ApiZodResponse(200, VenuePage)
  listVenues(@CurrentUser() m: AuthUser, @Query(zodPipe(PaginationSchema)) page: Pagination) {
    return this.catalog.listVenues(m, page);
  }

  @Get('venues/:id')
  @ApiZodResponse(200, VenueResponse)
  getVenue(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string) {
    return this.catalog.getVenue(m, id);
  }

  @Patch('venues/:id')
  @ApiZodBody(UpdateVenueSchema)
  @ApiZodResponse(200, VenueResponse)
  updateVenue(
    @CurrentUser() m: AuthUser,
    @Param('id', zodPipe(ObjectIdSchema)) id: string,
    @Body(zodPipe(UpdateVenueSchema)) body: UpdateVenue,
  ) {
    return this.catalog.updateVenue(m, id, body);
  }

  @Post('venues/:id/halls')
  @ApiZodBody(AddHallSchema)
  @ApiZodResponse(201, VenueResponse)
  addHall(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string, @Body(zodPipe(AddHallSchema)) body: AddHall) {
    return this.catalog.addHall(m, id, body);
  }

  @Put('venues/:id/halls/:hallId/layout')
  @ApiOperation({ summary: 'Save a new seat layout version for a hall' })
  @ApiZodBody(PutLayoutSchema)
  @ApiZodResponse(200, LayoutResponse)
  putLayout(
    @CurrentUser() m: AuthUser,
    @Param('id', zodPipe(ObjectIdSchema)) id: string,
    @Param('hallId', HallIdPipe) hallId: string,
    @Body(zodPipe(PutLayoutSchema)) body: PutLayout,
  ) {
    return this.catalog.putLayout(m, id, hallId, body);
  }

  @Get('venues/:id/halls/:hallId/layout')
  @ApiZodResponse(200, LayoutResponse)
  getLayout(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string, @Param('hallId', HallIdPipe) hallId: string) {
    return this.catalog.getLayout(m, id, hallId);
  }

  // ── Events ──
  @Post('events')
  @ApiOperation({ summary: 'Create an event (DRAFT)' })
  @ApiZodBody(CreateEventSchema)
  @ApiZodResponse(201, EventResponse)
  createEvent(@CurrentUser() m: AuthUser, @Body(zodPipe(CreateEventSchema)) body: CreateEvent) {
    return this.catalog.createEvent(m, body);
  }

  @Get('events')
  @ApiZodQuery(PaginationSchema)
  @ApiZodResponse(200, EventPage)
  listEvents(@CurrentUser() m: AuthUser, @Query(zodPipe(PaginationSchema)) page: Pagination) {
    return this.catalog.listEvents(m, page);
  }

  @Get('events/:id')
  @ApiZodResponse(200, EventResponse)
  getEvent(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string) {
    return this.catalog.getEvent(m, id);
  }

  @Patch('events/:id')
  @ApiZodBody(UpdateEventSchema)
  @ApiZodResponse(200, EventResponse)
  updateEvent(
    @CurrentUser() m: AuthUser,
    @Param('id', zodPipe(ObjectIdSchema)) id: string,
    @Body(zodPipe(UpdateEventSchema)) body: UpdateEvent,
  ) {
    return this.catalog.updateEvent(m, id, body);
  }

  @Post('events/:id/publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'DRAFT → PUBLISHED (visible to customers once a show is on sale)',
  })
  @ApiZodResponse(200, EventResponse)
  publishEvent(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string) {
    return this.catalog.publishEvent(m, id);
  }

  // ── Shows ──
  @Post('shows')
  @ApiOperation({
    summary: 'Schedule a show (prices in minor units, e.g. paise)',
  })
  @ApiZodBody(CreateShowSchema)
  @ApiZodResponse(201, ShowResponse)
  createShow(@CurrentUser() m: AuthUser, @Body(zodPipe(CreateShowSchema)) body: CreateShow) {
    return this.catalog.createShow(m, body);
  }

  @Get('shows')
  @ApiZodQuery(ManagerShowsQuerySchema)
  @ApiZodResponse(200, ShowPage)
  listShows(@CurrentUser() m: AuthUser, @Query(zodPipe(ManagerShowsQuerySchema)) query: ManagerShowsQuery) {
    return this.catalog.listShows(m, query);
  }

  @Get('shows/:id')
  @ApiZodResponse(200, ShowResponse)
  getShow(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string) {
    return this.catalog.getShow(m, id);
  }

  @Patch('shows/:id')
  @ApiZodBody(UpdateShowSchema)
  @ApiZodResponse(200, ShowResponse)
  updateShow(
    @CurrentUser() m: AuthUser,
    @Param('id', zodPipe(ObjectIdSchema)) id: string,
    @Body(zodPipe(UpdateShowSchema)) body: UpdateShow,
  ) {
    return this.catalog.updateShow(m, id, body);
  }

  @Post('shows/:id/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'SCHEDULED → ON_SALE (creates the seat inventory)' })
  @ApiZodResponse(200, PublishedShowResponse)
  publishShow(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string) {
    return this.catalog.publishShow(m, id);
  }

  @Post('shows/:id/seats/block')
  @HttpCode(200)
  @ApiZodBody(SeatIdsSchema)
  @ApiZodResponse(200, BlockSeatsResponse)
  block(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string, @Body(zodPipe(SeatIdsSchema)) body: SeatIds) {
    return this.catalog.blockSeats(m, id, body.seatIds, true);
  }

  @Post('shows/:id/seats/unblock')
  @HttpCode(200)
  @ApiZodBody(SeatIdsSchema)
  @ApiZodResponse(200, BlockSeatsResponse)
  unblock(@CurrentUser() m: AuthUser, @Param('id', zodPipe(ObjectIdSchema)) id: string, @Body(zodPipe(SeatIdsSchema)) body: SeatIds) {
    return this.catalog.blockSeats(m, id, body.seatIds, false);
  }
}
