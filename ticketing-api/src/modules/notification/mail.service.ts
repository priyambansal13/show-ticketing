import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; cid?: string; contentType?: string }>;
}

/** SMTP mail (Mailpit locally, SES SMTP in production). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    this.from = config.get('MAIL_FROM', { infer: true });
    this.transport = nodemailer.createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: false,
      requireTLS: config.get('SMTP_REQUIRE_TLS', { infer: true }),
      auth: config.get('SMTP_USER', { infer: true })
        ? { user: config.get('SMTP_USER', { infer: true })!, pass: config.get('SMTP_PASS', { infer: true }) ?? '' }
        : undefined,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
    this.logger.log({ subject: message.subject }, 'Email sent');
  }
}

/** SMS stub: logs instead of sending (Twilio adapter goes here). Never logs the number. */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  send(phone: string | null, text: string): Promise<void> {
    if (!phone) return Promise.resolve();
    this.logger.log({ to: `***${phone.slice(-3)}`, length: text.length }, 'SMS (stub) sent');
    return Promise.resolve();
  }
}
