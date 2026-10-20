import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { MailService, SmsService } from './mail.service.js';
import { NotificationConsumer } from './notification.consumer.js';

@Module({
  imports: [BookingModule],
  providers: [MailService, SmsService, NotificationConsumer],
})
export class NotificationModule {}
