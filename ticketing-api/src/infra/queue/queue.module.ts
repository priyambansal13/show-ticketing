import { Global, Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service.js';
import { QueueService } from './queue.service.js';

@Global()
@Module({
  providers: [QueueService, MaintenanceService],
  exports: [QueueService],
})
export class QueueModule {}
