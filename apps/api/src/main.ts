import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { buildSwaggerDocument } from './swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS_ORIGIN is an explicit allowlist (comma-separated) for production.
  // In development, also accept any http origin on the same port so the
  // Next dev server stays reachable from other devices on the LAN (e.g.
  // http://192.168.x.x:3000 when testing from a phone) without having to
  // hand-edit .env every time the machine's LAN IP changes.
  const corsOrigins = (
    config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000'
  )
    .split(',')
    .map((origin) => origin.trim());
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const devLanOriginPattern =
    /^http:\/\/(localhost|127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):3000$/;

  const corsOriginValidator: CustomOrigin = (origin, callback) => {
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    if (!isProduction && devLanOriginPattern.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  };

  app.enableCors({
    origin: corsOriginValidator,
    credentials: true,
  });

  const document = buildSwaggerDocument(app);
  SwaggerModule.setup('docs', app, document);

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
}
void bootstrap();
