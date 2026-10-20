import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { CheckoutConfirmationResponse, InitiatePaymentResponse, VerifyPaymentResponse } from '../booking/dto/booking.responses.js';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type AuthUser } from '../../common/auth/auth.decorators.js';
import { Idempotent } from '../../common/idempotency/idempotency.interceptor.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard.js';
import { ApiZodBody, ApiZodResponse, zodPipe } from '../../common/validation/zod.js';
import {
  FakeCompleteSchema,
  InitiatePaymentSchema,
  VerifyPaymentSchema,
  type FakeComplete,
  type InitiatePayment,
  type VerifyPayment,
} from './dto/payment.dto.js';
import { PaymentService } from './payment.service.js';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('initiate')
  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Idempotent()
  @ApiOperation({
    summary: 'Create (or reuse) a provider order for a held booking',
  })
  @ApiZodBody(InitiatePaymentSchema)
  @ApiZodResponse(201, InitiatePaymentResponse)
  initiate(@CurrentUser() customer: AuthUser, @Body(zodPipe(InitiatePaymentSchema)) body: InitiatePayment) {
    return this.payments.initiate(customer, body.bookingId);
  }

  @Post('verify')
  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @HttpCode(200)
  @RateLimit({
    scope: 'payment-verify',
    limit: 20,
    windowSeconds: 60,
    by: 'user',
  })
  @ApiOperation({
    summary: 'Confirm a checkout payment (signature + provider check)',
  })
  @ApiZodBody(VerifyPaymentSchema)
  @ApiZodResponse(200, VerifyPaymentResponse)
  verify(@CurrentUser() customer: AuthUser, @Body(zodPipe(VerifyPaymentSchema)) body: VerifyPayment) {
    return this.payments.verifyCheckout(customer, body);
  }

  /** Development only — the fake provider's stand-in for the browser checkout. 404 otherwise. */
  @Post('fake/complete')
  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @HttpCode(200)
  @ApiOperation({
    summary: '[dev, fake provider] Simulate a successful checkout for an order',
  })
  @ApiZodBody(FakeCompleteSchema)
  @ApiZodResponse(200, CheckoutConfirmationResponse)
  fakeComplete(@CurrentUser() customer: AuthUser, @Body(zodPipe(FakeCompleteSchema)) body: FakeComplete) {
    return this.payments.fakeCheckout(customer, body.orderId);
  }

  @Post('webhook/:provider')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  webhook(
    @Param('provider', zodPipe(z.string().regex(/^[a-z]{2,20}$/)))
    provider: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.payments.handleWebhook(provider, req.rawBody, req.headers);
  }
}
