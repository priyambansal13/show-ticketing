import { Module } from '@nestjs/common';
import { AuditConsumer } from './audit.consumer.js';
import { AuditService } from './audit.service.js';

@Module({
  providers: [AuditService, AuditConsumer],
  exports: [AuditService],
})
export class AuditModule {}
