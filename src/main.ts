import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  const corsOrigins = configService.get<string>('CORS_ORIGINS');
  if (corsOrigins) {
    const origins = corsOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    app.enableCors({
      origin: origins,
      credentials: true,
    });
  } else {
    // Default to localhost-only origins when CORS_ORIGINS is not configured.
    // Never use app.enableCors() with no args — that allows ALL origins.
    logger.warn(
      'CORS_ORIGINS is not set. Restricting to localhost origins only. ' +
        'Set CORS_ORIGINS in production.',
    );
    app.enableCors({
      origin: [
        'http://localhost:3000',
        'http://localhost:8081',
        'http://localhost:19006',
      ],
      credentials: true,
    });
  }

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = configService.get<number>('PORT') ?? 3000;

  await app.listen(port);
  logger.log(`Listening on port ${port}`);
}
void bootstrap();
