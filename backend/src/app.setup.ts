import { HttpStatus, ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

// Shared by main.ts and the e2e tests, so the tests run the exact production setup.
export function setupApp(app: NestExpressApplication) {
  app.use(helmet());
  // Express adds an ETag (a fingerprint of the body) to every response. When the
  // client sends it back in If-None-Match and nothing changed, the answer is 304
  // with no body. This line only states that default openly.
  app.set('etag', 'weak');
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useStaticAssets('uploads', { prefix: '/uploads' });

  const config = new DocumentBuilder()
    .setTitle('E-Commerce API')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, config),
  );
  return app;
}
