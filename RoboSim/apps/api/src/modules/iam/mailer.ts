import { uuidv7, type DevMail } from '@robosim/shared';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** The one action link in the message, kept separately so the dev sink can offer it as a button. */
  link?: string;
}

/** Outgoing email port (Technical Design §10: `EmailProvider`). The SMTP adapter arrives with staging. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/** Development sink: keeps the latest messages in memory for `GET /dev/mail` and the web app's /dev/mail page. */
export class DevMailSink implements Mailer {
  private readonly messages: DevMail[] = [];

  constructor(private readonly capacity = 100) {}

  send(message: MailMessage): Promise<void> {
    this.messages.unshift({
      id: uuidv7(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      link: message.link ?? null,
      sentAt: new Date().toISOString(),
    });
    this.messages.length = Math.min(this.messages.length, this.capacity);
    return Promise.resolve();
  }

  /** Newest first, optionally only those sent to `to`. */
  list(to?: string): DevMail[] {
    return to ? this.messages.filter((m) => m.to === to) : [...this.messages];
  }
}
