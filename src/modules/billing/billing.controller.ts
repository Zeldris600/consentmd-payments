import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgAdminGuard } from '../auth/org-admin.guard';
import { InternalApiKeyGuard } from '../auth/internal-api-key.guard';
import {
  BearerToken,
  CurrentUser,
  type CurrentUserData,
} from '../auth/current-user.decorator';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CreatePortalDto } from './dto/create-portal.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  @ApiOperation({
    summary: 'List subscription plans (public)',
    description:
      'Returns Starter, Pro, and Enterprise tiers with seat ranges and monthly USD prices. ' +
      'No authentication required — safe to call from marketing/pricing pages.',
  })
  listPlans() {
    return this.billingService.listPlans();
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Create Stripe Checkout session (new subscription)',
    description:
      'Starts Stripe Checkout for an organization that does **not** already have a Stripe subscription. ' +
      'Requires org admin. The `plan` must match the org member count from the IdP (starter: 1–25, pro: 26–50, enterprise: 51+). ' +
      'Returns `checkoutUrl` — redirect the user there. On success, webhooks activate the subscription; poll `GET /subscription`.',
  })
  createCheckout(
    @CurrentUser() user: CurrentUserData,
    @BearerToken() bearerToken: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.billingService.createCheckout(user, bearerToken!, dto);
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiQuery({
    name: 'organizationId',
    required: true,
    description: 'Laravel organization ID',
  })
  @ApiOperation({
    summary: 'Get organization subscription and entitlement',
    description:
      'Returns the cached Postgres subscription record plus a computed entitlement object. ' +
      '`seatCount` is refreshed from the IdP when possible. Use after checkout to poll until `entitlement.active` is true.',
  })
  getSubscription(@Query('organizationId') organizationId: string) {
    return this.billingService.getSubscription(organizationId);
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Create Stripe Customer Portal session',
    description:
      'Returns a short-lived Stripe Billing Portal URL for payment method updates, invoice history, and cancellation (per Portal settings). ' +
      'Requires org admin and an existing Stripe customer for the organization.',
  })
  createPortal(@Body() dto: CreatePortalDto) {
    return this.billingService.createPortal(dto);
  }

  @Post('upgrade')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Change plan on existing subscription',
    description:
      'Updates the Stripe subscription price in-place with proration. Use when the org already has a subscription and needs a different tier (e.g. seat growth). ' +
      'Do **not** use Checkout for upgrades — use this endpoint instead.',
  })
  upgradeSubscription(
    @BearerToken() bearerToken: string,
    @Body() dto: UpgradeSubscriptionDto,
  ) {
    return this.billingService.upgradeSubscription(bearerToken!, dto);
  }

  @Get('entitlement/:organizationId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Get subscription entitlement (JWT)',
    description:
      'Lightweight entitlement for feature gating. Gate on `active === true`. ' +
      'Includes live `seatCount` from the IdP. Compare `seatCount` vs `seatLimit` to prompt upgrades.',
  })
  getEntitlementWithJwt(
    @Param('organizationId') organizationId: string,
    @BearerToken() bearerToken: string,
  ) {
    return this.billingService.getEntitlement(organizationId, bearerToken);
  }

  @Get('internal/entitlement/:organizationId')
  @UseGuards(InternalApiKeyGuard)
  @ApiHeader({
    name: 'x-api-key',
    required: true,
    description: 'Shared INTERNAL_API_KEY (service-to-service)',
  })
  @ApiOperation({
    summary: 'Get subscription entitlement (internal API key)',
    description:
      'Same entitlement shape as the JWT route, for backend services. ' +
      'Requires `x-api-key` header matching `INTERNAL_API_KEY`. `seatCount` comes from the DB cache.',
  })
  getEntitlementInternal(@Param('organizationId') organizationId: string) {
    return this.billingService.getEntitlement(organizationId);
  }
}
