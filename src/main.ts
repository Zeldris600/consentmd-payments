import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { AppModule } from './app.module';
import { parseCorsOrigins } from './common/utils/cors.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);
  const rawCorsOrigin = configService.getOrThrow<string>('CORS_ORIGIN');
  const corsOrigin = parseCorsOrigins(rawCorsOrigin);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  app.use(express.urlencoded({ extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ConsentMD Payments API')
    .setDescription(
      [
        'Stripe subscription billing for ConsentMD organizations.',
        '',
        '**Auth:** Most routes require a Laravel IdP JWT (`Authorization: Bearer`).',
        'Checkout, portal, and upgrade also require org admin role.',
        '`GET /billing/plans` is public.',
        '',
        '**DEV only:** `POST /dev/auth/login` proxies Laravel sign-in and returns `access_token` for Swagger.',
        '',
        '**Docs:** `docs/INTEGRATION.md` (API reference) · `docs/LOCAL_DEVELOPMENT.md` (setup)',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'bearer',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  const port = configService.getOrThrow<number>('PORT');
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  const baseUrl = `http://localhost:${port}`;
  logger.log(`HTTP server listening on ${baseUrl}`);
  logger.log(`Swagger docs : ${baseUrl}/api/docs`);
}

bootstrap();
