import { ConfigService } from '@nestjs/config';
import { BullRootModuleOptions } from '@nestjs/bull';

export const getRedisConfig = (
  configService: ConfigService,
): BullRootModuleOptions => ({
  redis: {
    host: configService.get<string>('REDIS_HOST', 'localhost'),
    port: configService.get<number>('REDIS_PORT', 6379),
    password: configService.get<string>('REDIS_PASSWORD') || undefined,
    connectTimeout: 10_000,
    retryStrategy: (times: number) => Math.min(times * 50, 2_000),
  },
});
