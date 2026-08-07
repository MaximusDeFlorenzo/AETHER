import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Single source of truth for the Swagger/OpenAPI document config — used by
 * both `main.ts` (serves it at `/docs` + `/docs-json` on a running server)
 * and `generate-openapi.ts` (writes it to a static file for
 * `packages/contracts`' codegen, which needs a document without requiring a
 * live, fully-connected server in CI). */
export function buildSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('AETHER API')
    .setDescription('AETHER multi-hazard risk-prediction platform backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
