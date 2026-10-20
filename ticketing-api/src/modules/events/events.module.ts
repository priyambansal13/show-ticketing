import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CatalogCacheService } from './catalog-cache.service.js';
import { ManagerCatalogController } from './manager-catalog.controller.js';
import { ManagerCatalogService } from './manager-catalog.service.js';
import { PublicCatalogController } from './public-catalog.controller.js';
import { PublicCatalogService } from './public-catalog.service.js';
import { Event, EventSchema } from './schemas/event.schema.js';
import { SeatLayout, SeatLayoutSchema } from './schemas/seat-layout.schema.js';
import { Show, ShowSchema } from './schemas/show.schema.js';
import { Venue, VenueSchema } from './schemas/venue.schema.js';

/**
 * Catalog: venues, seat layouts, events, shows (MongoDB) — manager CRUD and
 * public browsing. Other modules use the exported services, never the models.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Venue.name, schema: VenueSchema },
      { name: SeatLayout.name, schema: SeatLayoutSchema },
      { name: Event.name, schema: EventSchema },
      { name: Show.name, schema: ShowSchema },
    ]),
    InventoryModule,
    AuditModule,
  ],
  controllers: [ManagerCatalogController, PublicCatalogController],
  providers: [ManagerCatalogService, PublicCatalogService, CatalogCacheService],
  exports: [ManagerCatalogService, PublicCatalogService],
})
export class EventsModule {}
