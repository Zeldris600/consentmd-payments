import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { OrganizationSubscription } from '../modules/billing/entities/organization-subscription.entity';

function useSsl(databaseUrl: string, nodeEnv: string): boolean | { rejectUnauthorized: boolean } {
  if (databaseUrl.includes('neon.tech') || databaseUrl.includes('sslmode=require')) {
    return { rejectUnauthorized: false };
  }
  return nodeEnv === 'PROD' ? { rejectUnauthorized: false } : false;
}

export const getDatabaseConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
  const nodeEnv = configService.get<string>('NODE_ENV', 'DEV');
  const isDev = nodeEnv === 'DEV';

  return {
    type: 'postgres',
    url: databaseUrl,
    entities: [OrganizationSubscription],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    synchronize: isDev,
    logging: isDev,
    ssl: useSsl(databaseUrl, nodeEnv),
    extra: {
      max: 20,
      min: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    },
  };
};
