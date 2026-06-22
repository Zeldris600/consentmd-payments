import { DataSource } from 'typeorm';
import { join } from 'path';

const databaseUrl = process.env.DATABASE_URL;
const nodeEnv = process.env.NODE_ENV ?? 'DEV';

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for TypeORM CLI');
}

const useSsl =
  databaseUrl.includes('neon.tech') ||
  databaseUrl.includes('sslmode=require') ||
  nodeEnv === 'PROD';

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  entities: [join(__dirname, 'src', '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'src', 'database', 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: nodeEnv === 'DEV',
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});
