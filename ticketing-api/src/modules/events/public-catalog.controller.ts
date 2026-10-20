import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  CitiesResponse,
  EventPage,
  EventResponse,
  EventShowResponse,
  SeatMapResponse,
  ShowDetailResponse,
} from './dto/catalog.responses.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../../common/auth/auth.decorators.js';
import { ApiZodQuery, ApiZodResponse, ObjectIdSchema, zodPipe } from '../../common/validation/zod.js';
import { BrowseEventsQuerySchema, EventShowsQuerySchema, type BrowseEventsQuery, type EventShowsQuery } from './dto/catalog.dto.js';
import { PublicCatalogService } from './public-catalog.service.js';

const IdOrSlugSchema = z.string().min(1).max(220);

@ApiTags('catalog')
@Public()
@Controller()
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Get('cities')
  @ApiOperation({ summary: 'Cities with shows on sale' })
  @ApiZodResponse(200, CitiesResponse)
  cities() {
    return this.catalog.cities();
  }

  @Get('events')
  @ApiOperation({
    summary: 'Browse / search events that have upcoming shows on sale',
  })
  @ApiZodQuery(BrowseEventsQuerySchema)
  @ApiZodResponse(200, EventPage)
  browse(@Query(zodPipe(BrowseEventsQuerySchema)) query: BrowseEventsQuery) {
    return this.catalog.browseEvents(query);
  }

  @Get('events/:idOrSlug')
  @ApiOperation({ summary: 'Event detail by id or slug' })
  @ApiZodResponse(200, EventResponse)
  event(@Param('idOrSlug', zodPipe(IdOrSlugSchema)) idOrSlug: string) {
    return this.catalog.event(idOrSlug);
  }

  @Get('events/:id/shows')
  @ApiOperation({ summary: 'Upcoming shows of an event' })
  @ApiZodQuery(EventShowsQuerySchema)
  @ApiZodResponse(200, z.array(EventShowResponse))
  eventShows(@Param('id', zodPipe(ObjectIdSchema)) id: string, @Query(zodPipe(EventShowsQuerySchema)) query: EventShowsQuery) {
    return this.catalog.eventShows(id, query);
  }

  @Get('shows/:id')
  @ApiOperation({ summary: 'Show detail with event and venue' })
  @ApiZodResponse(200, ShowDetailResponse)
  show(@Param('id', zodPipe(ObjectIdSchema)) id: string) {
    return this.catalog.show(id);
  }

  @Get('shows/:id/seats')
  @ApiOperation({ summary: 'Seat map with live availability' })
  @ApiZodResponse(200, SeatMapResponse)
  seats(@Param('id', zodPipe(ObjectIdSchema)) id: string) {
    return this.catalog.seatMap(id);
  }
}
