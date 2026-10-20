import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Redis } from 'ioredis';
import QRCode from 'qrcode';
import { KafkaService } from '../../infra/kafka/kafka.service.js';
import { TOPICS } from '../../infra/outbox/outbox.service.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { BookingService } from '../booking/booking.service.js';
import { MailService, SmsService } from './mail.service.js';

interface BookingEvent {
  bookingId: string;
  refundAmount?: string;
  amount?: string;
  reason?: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const formatWhen = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/**
 * Customer notifications from booking/payment events: confirmation with the
 * ticket QR, cancellation, refund. All user-supplied text is HTML-escaped.
 */
@Injectable()
export class NotificationConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    private readonly kafka: KafkaService,
    private readonly bookings: BookingService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Runs one side effect at most once per event (email and SMS are tracked
   * separately, so retrying a failed SMS never re-sends the email).
   */
  private async once(eventId: string | null, channel: string, send: () => Promise<void>): Promise<void> {
    const key = eventId ? `notified:${eventId}:${channel}` : null;
    if (key && (await this.redis.exists(key))) return;
    await send();
    if (key) await this.redis.set(key, '1', 'EX', 7 * 86_400);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.kafka.consume<BookingEvent>(
      'ticketing-notifications',
      [TOPICS.bookingConfirmed, TOPICS.bookingCancelled, TOPICS.refundProcessed],
      async ({ topic, value, outboxId }) => this.handle(topic, value, outboxId),
    );
  }

  async handle(topic: string, event: BookingEvent, eventId: string | null = null): Promise<void> {
    const context = await this.bookings.notificationContext(event.bookingId);
    if (!context) {
      this.logger.warn({ topic, bookingId: event.bookingId }, 'Booking not found for notification');
      return;
    }
    const { customer, booking, ticketCode } = context;
    const title = escapeHtml(booking.show?.eventTitle ?? 'your event');
    const when = booking.show ? formatWhen(booking.show.startsAt) : '';
    const where = booking.show ? escapeHtml(`${booking.show.venueName}, ${booking.show.hallName}`) : '';
    const seats = booking.seats.map((s) => s.seatId).join(', ');
    const hello = `Hi ${escapeHtml(customer.name)},`;

    if (topic === TOPICS.bookingConfirmed && ticketCode) {
      const qr = await QRCode.toBuffer(ticketCode, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
      await this.once(eventId, 'email', () =>
        this.mail.send({
          to: customer.email,
          subject: `Booking confirmed — ${booking.show?.eventTitle ?? 'your tickets'} (${booking.bookingRef})`,
          text: `Booking ${booking.bookingRef} is confirmed. ${booking.show?.eventTitle ?? ''} — ${when} at ${booking.show?.venueName ?? ''}. Seats: ${seats}. Total: ${booking.currency} ${booking.totalAmount}.`,
          html: `<p>${hello}</p><p>Your booking <strong>${booking.bookingRef}</strong> is confirmed.</p>
<p><strong>${title}</strong><br>${escapeHtml(when)}<br>${where}</p>
<p>Seats: <strong>${escapeHtml(seats)}</strong><br>Total paid: ${booking.currency} ${booking.totalAmount}</p>
<p>Show this QR code at the entrance:</p><p><img src="cid:ticket-qr" alt="Ticket QR code for ${booking.bookingRef}" width="240" height="240"></p>`,
          attachments: [{ filename: `${booking.bookingRef}.png`, content: qr, cid: 'ticket-qr', contentType: 'image/png' }],
        }),
      );
      await this.once(eventId, 'sms', () =>
        this.sms.send(
          customer.phone,
          `Booking ${booking.bookingRef} confirmed: ${booking.show?.eventTitle ?? ''}, ${when}. Seats ${seats}.`,
        ),
      );
      return;
    }

    if (topic === TOPICS.bookingCancelled) {
      const refund =
        event.refundAmount && event.refundAmount !== '0.00'
          ? `A refund of ${booking.currency} ${event.refundAmount} has been initiated.`
          : 'No refund applies.';
      const reason = event.reason === 'show_cancelled' ? 'The organiser cancelled this show.' : 'You cancelled this booking.';
      await this.once(eventId, 'email', () =>
        this.mail.send({
          to: customer.email,
          subject: `Booking cancelled — ${booking.bookingRef}`,
          text: `${reason} Booking ${booking.bookingRef} for ${booking.show?.eventTitle ?? 'your event'} is cancelled. ${refund}`,
          html: `<p>${hello}</p><p>${reason} Your booking <strong>${booking.bookingRef}</strong> for <strong>${title}</strong> (${escapeHtml(when)}) is cancelled.</p><p>${refund}</p>`,
        }),
      );
      return;
    }

    if (topic === TOPICS.refundProcessed) {
      await this.once(eventId, 'email', () =>
        this.mail.send({
          to: customer.email,
          subject: `Refund processed — ${booking.bookingRef}`,
          text: `Your refund of ${booking.currency} ${event.amount ?? ''} for booking ${booking.bookingRef} has been processed.`,
          html: `<p>${hello}</p><p>Your refund of <strong>${booking.currency} ${escapeHtml(event.amount ?? '')}</strong> for booking <strong>${booking.bookingRef}</strong> has been processed. It may take 5–7 working days to appear.</p>`,
        }),
      );
    }
  }
}
