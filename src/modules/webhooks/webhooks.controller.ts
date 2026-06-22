import {
  Controller,
  Headers,
  Post,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeService } from '../stripe/stripe.service';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@ApiExcludeController()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly webhooksService: WebhooksService,
  ) {}

  @Post('stripe')
  @ApiOperation({ summary: 'Stripe webhook ingress' })
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    const event = this.stripeService.constructWebhookEvent(rawBody, signature);
    await this.webhooksService.enqueueStripeEvent(event);

    return { received: true };
  }
}
