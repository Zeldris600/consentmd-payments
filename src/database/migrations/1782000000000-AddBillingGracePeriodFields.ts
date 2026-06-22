import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingGracePeriodFields1782000000000
  implements MigrationInterface
{
  name = 'AddBillingGracePeriodFields1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "organization_subscriptions_status_enum"
      ADD VALUE IF NOT EXISTS 'suspended'
    `);

    await queryRunner.query(`
      ALTER TABLE "organization_subscriptions"
      ADD COLUMN IF NOT EXISTS "past_due_since" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "grace_period_end" TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "organization_subscriptions"
      DROP COLUMN IF EXISTS "suspended_at",
      DROP COLUMN IF EXISTS "grace_period_end",
      DROP COLUMN IF EXISTS "past_due_since"
    `);
  }
}
