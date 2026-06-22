import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

export enum EnvironmentType {
  DEV = 'DEV',
  PROD = 'PROD',
  STAGING = 'STAGING',
}

class EnvironmentVariables {
  @IsEnum(EnvironmentType)
  NODE_ENV: EnvironmentType;

  @IsNumber()
  PORT: number;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @IsOptional()
  REDIS_HOST?: string;

  @IsNumber()
  @IsOptional()
  REDIS_PORT?: number;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  @IsString()
  CORS_ORIGIN: string;

  @IsString()
  @IsNotEmpty()
  LARAVEL_JWT_PUBLIC_KEY: string;

  @IsString()
  @IsOptional()
  LARAVEL_BASE_URL?: string;

  @IsNumber()
  @IsOptional()
  LARAVEL_HTTP_TIMEOUT_MS?: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(24, {
    message:
      'STRIPE_SECRET_KEY looks too short — paste the full secret from Stripe Dashboard',
  })
  @Matches(/^sk_(test|live)_/, {
    message: 'STRIPE_SECRET_KEY must start with sk_test_ or sk_live_',
  })
  STRIPE_SECRET_KEY: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(20, {
    message:
      'STRIPE_WEBHOOK_SECRET looks too short — use `stripe listen` or the Dashboard webhook signing secret',
  })
  @Matches(/^whsec_/, {
    message:
      'STRIPE_WEBHOOK_SECRET must start with whsec_ (from Stripe Dashboard or `stripe listen`)',
  })
  STRIPE_WEBHOOK_SECRET: string;

  @IsString()
  @IsOptional()
  STRIPE_PRICE_STARTER?: string;

  @IsString()
  @IsOptional()
  STRIPE_PRICE_PRO?: string;

  @IsString()
  @IsOptional()
  STRIPE_PRICE_ENTERPRISE?: string;

  @IsString()
  @IsOptional()
  INTERNAL_API_KEY?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(32, {
    message:
      'CONSENTMD_INTERNAL_API_KEY looks too short — use the key from Laravel INTERNAL_API_KEYS',
  })
  CONSENTMD_INTERNAL_API_KEY: string;

  @IsNumber()
  @IsOptional()
  BILLING_GRACE_PERIOD_DAYS?: number;

  @IsNumber()
  @IsOptional()
  BILLING_SUSPENDED_SEAT_LIMIT?: number;

  @IsString()
  @IsOptional()
  BILLING_APP_URL?: string;

  @IsString()
  @IsOptional()
  SMTP_HOST?: string;

  @IsNumber()
  @IsOptional()
  SMTP_PORT?: number;

  @IsString()
  @IsOptional()
  SMTP_USER?: string;

  @IsString()
  @IsOptional()
  SMTP_PASSWORD?: string;

  @IsString()
  @IsOptional()
  EMAIL_FROM?: string;
}

export function validate(configuration: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, configuration, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    throw new Error(
      `Environment validation failed:\n- ${messages.join('\n- ')}`,
    );
  }

  return validatedConfig;
}
