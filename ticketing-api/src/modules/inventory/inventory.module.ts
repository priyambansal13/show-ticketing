import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { SeatsGateway } from './seats.gateway.js';

@Module({
  providers: [InventoryService, SeatsGateway],
  exports: [InventoryService],
})
export class InventoryModule {}
