import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { EventsModule } from '../events/events.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { BookingController, ManagerBookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [EventsModule, InventoryModule, AuditModule, LedgerModule],
  controllers: [BookingController, ManagerBookingController],
  providers: [BookingService, ReportsService],
  exports: [BookingService],
})
export class BookingModule {}
