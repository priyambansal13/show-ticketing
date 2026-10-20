import { Global, Module } from '@nestjs/common';
import { OutboxRelayService } from '../outbox/outbox-relay.service.js';
import { KafkaService } from './kafka.service.js';

@Global()
@Module({
  providers: [KafkaService, OutboxRelayService],
  exports: [KafkaService],
})
export class KafkaModule {}
