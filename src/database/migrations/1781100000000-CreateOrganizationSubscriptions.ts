import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrganizationSubscriptions1781100000000
  implements MigrationInterface
{
  name = 'CreateOrganizationSubscriptions1781100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "organization_subscriptions_plan_enum" AS ENUM (
        'starter', 'pro', 'enterprise'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "organization_subscriptions_status_enum" AS ENUM (
        'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "organization_subscriptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" character varying(255) NOT NULL,
        "tenant" character varying(255),
        "stripe_customer_id" character varying(255) NOT NULL,
        "stripe_subscription_id" character varying(255),
        "plan" "organization_subscriptions_plan_enum" NOT NULL,
        "status" "organization_subscriptions_status_enum" NOT NULL DEFAULT 'incomplete',
        "seat_count" integer NOT NULL DEFAULT 0,
        "seat_limit" integer NOT NULL,
        "current_period_end" TIMESTAMP WITH TIME ZONE,
        "billing_email" character varying(320),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_organization_subscriptions_org" UNIQUE ("organization_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_organization_subscriptions_org"
      ON "organization_subscriptions" ("organization_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "organization_subscriptions"`);
    await queryRunner.query(`DROP TYPE "organization_subscriptions_status_enum"`);
    await queryRunner.query(`DROP TYPE "organization_subscriptions_plan_enum"`);
  }
}
