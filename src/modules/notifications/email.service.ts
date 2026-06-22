import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import { ApiConfigService } from '../../config/api-config.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from?: string;
  private readonly transporter?: nodemailer.Transporter;

  constructor(private readonly apiConfig: ApiConfigService) {
    const smtp = this.apiConfig.smtpConfig;
    if (!smtp) {
      this.logger.log(
        'SMTP not configured — billing emails will be logged only',
      );
      return;
    }

    this.from = smtp.from;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });
    this.logger.log('SMTP configured — billing email delivery enabled');
  }

  get isConfigured(): boolean {
    return !!this.transporter && !!this.from;
  }

  async sendMail(options: Mail.Options): Promise<void> {
    if (!this.transporter || !this.from) {
      this.logger.log(
        `[email skipped] to=${String(options.to)} subject=${options.subject}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, ...options });
      this.logger.log(`Email sent to ${String(options.to)}: ${options.subject}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send email to ${String(options.to)}: ${message}`);
      throw error;
    }
  }
}
