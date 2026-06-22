import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiConfigService {
  private readonly logger = new Logger(ApiConfigService.name);

  constructor(private readonly configService: ConfigService) {}

  private requireNonEmpty(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new Error(
        `Missing or empty environment variable: ${key}. Check your .env file.`,
      );
    }
    return value;
  }

  get nodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'DEV');
  }

  get apiPort(): number {
    return this.configService.get<number>('PORT', 3001);
  }

  get corsOrigin(): string {
    return this.configService.get<string>('CORS_ORIGIN', '*');
  }

  get databaseUrl(): string {
    return this.configService.getOrThrow<string>('DATABASE_URL');
  }

  get redisHost(): string {
    return this.configService.get<string>('REDIS_HOST', 'localhost');
  }

  get redisPort(): number {
    return this.configService.get<number>('REDIS_PORT', 6379);
  }

  get jwtPublicKey(): string {
    return this.configService.getOrThrow<string>('LARAVEL_JWT_PUBLIC_KEY');
  }

  get laravelBaseUrl(): string {
    const baseUrl =
      this.configService.get<string>('LARAVEL_BASE_URL') ||
      'https://consent-plus-laravel-temp-i4gf7s.laravel.cloud';
    if (!this.configService.get<string>('LARAVEL_BASE_URL')) {
      this.logger.warn(
        'LARAVEL_BASE_URL not set, falling back to default Laravel URL',
      );
    }
    return baseUrl.replace(/\/$/, '');
  }

  get laravelHttpTimeoutMs(): number {
    return this.configService.get<number>('LARAVEL_HTTP_TIMEOUT_MS', 10000);
  }

  get stripeSecretKey(): string {
    return this.requireNonEmpty('STRIPE_SECRET_KEY');
  }

  get stripeWebhookSecret(): string {
    return this.requireNonEmpty('STRIPE_WEBHOOK_SECRET');
  }

  get stripePriceStarter(): string | undefined {
    return this.configService.get<string>('STRIPE_PRICE_STARTER')?.trim() || undefined;
  }

  get stripePricePro(): string | undefined {
    return this.configService.get<string>('STRIPE_PRICE_PRO')?.trim() || undefined;
  }

  get stripePriceEnterprise(): string | undefined {
    return (
      this.configService.get<string>('STRIPE_PRICE_ENTERPRISE')?.trim() ||
      undefined
    );
  }

  /** Key other services use to call this payments service. */
  get internalApiKey(): string | undefined {
    return this.configService.get<string>('INTERNAL_API_KEY')?.trim() || undefined;
  }

  /** Key this service uses to call Laravel `GET /api/internal/*`. */
  get consentmdInternalApiKey(): string | undefined {
    return (
      this.configService.get<string>('CONSENTMD_INTERNAL_API_KEY')?.trim() ||
      undefined
    );
  }

  get billingGracePeriodDays(): number {
    return this.configService.get<number>('BILLING_GRACE_PERIOD_DAYS', 7);
  }

  get billingSuspendedSeatLimit(): number {
    return this.configService.get<number>('BILLING_SUSPENDED_SEAT_LIMIT', 1);
  }

  /** Frontend base URL for billing portal return links and email CTAs. */
  get billingAppUrl(): string {
    return (
      this.configService.get<string>('BILLING_APP_URL')?.trim() ||
      this.configService.get<string>('CORS_ORIGIN', 'http://localhost:3000')
    ).replace(/\/$/, '');
  }

  get smtpConfig():
    | { host: string; port: number; user: string; pass: string; from: string }
    | undefined {
    const host = this.configService.get<string>('SMTP_HOST')?.trim();
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER')?.trim();
    const pass = this.configService.get<string>('SMTP_PASSWORD')?.trim();
    const from = this.configService.get<string>('EMAIL_FROM')?.trim();

    if (host && port && user && pass && from) {
      return { host, port: Number(port), user, pass, from };
    }
    return undefined;
  }
}
