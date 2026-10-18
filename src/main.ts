import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Render (and most PaaS) terminate TLS at a single reverse proxy and forward
  // the client address in X-Forwarded-For. Trusting exactly one hop makes
  // `req.ip` the real client IP, so the ThrottlerGuard rate-limits per user
  // instead of lumping every request under the proxy's address.
  app.set('trust proxy', 1);

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

  // Log every incoming request so we can see what's actually hitting the
  // server (helps spot mobile clients with the wrong host, missing auth
  // header, OPTIONS preflight failures, etc.).
  const http = app.getHttpAdapter().getInstance();
  http.use((req, _res, next) => {
    logger.log(
      `→ ${req.method} ${req.originalUrl} from ${req.ip} ` +
        `auth=${req.headers.authorization ? 'yes' : 'no'}`,
    );
    next();
  });

  await app.listen(port, '0.0.0.0');
  logger.log(`Listening on 0.0.0.0:${port} (reachable on LAN)`);
}
void bootstrap();
