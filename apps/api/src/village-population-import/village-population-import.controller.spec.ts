import 'reflect-metadata';
import { VillagePopulationImportController } from './village-population-import.controller';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

// Regression test for permission enforcement (#9 of the 100k-row e2e test
// matrix) — verified live that every endpoint returns 401 with no token
// and 403 for an authenticated field_reporter (neither admin nor
// analyst); this asserts the same guarantee at the metadata level so a
// future edit that accidentally drops `@UseGuards`/`@Roles` from one
// endpoint fails a fast unit test rather than only being caught by manual
// or live testing (the exact gap the `@Type(() => Boolean)` boolean-
// parsing bug fell into earlier in this project).
describe('VillagePopulationImportController — permission metadata', () => {
  const guardsMetadataKey = '__guards__';
  const endpoints: Array<[string, string]> = [
    ['create', 'POST /village-population-imports'],
    ['getBatch', 'GET /village-population-imports/:id'],
    ['getRows', 'GET /village-population-imports/:id/rows'],
    ['confirm', 'POST /village-population-imports/:id/confirm'],
    ['retry', 'POST /village-population-imports/:id/retry'],
    [
      'downloadErrorReport',
      'GET /village-population-imports/:id/error-report.csv',
    ],
  ];

  it.each(endpoints)(
    '%s (%s) requires JwtAuthGuard + RolesGuard',
    (methodName) => {
      const handler = (VillagePopulationImportController.prototype as any)[
        methodName
      ];
      const guards = Reflect.getMetadata(guardsMetadataKey, handler);
      expect(guards).toBeDefined();
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, RolesGuard]),
      );
    },
  );

  it.each(endpoints)(
    '%s (%s) restricts to ADMIN and ANALYST only',
    (methodName) => {
      const handler = (VillagePopulationImportController.prototype as any)[
        methodName
      ];
      const roles = Reflect.getMetadata(ROLES_KEY, handler);
      expect(roles).toEqual([RoleName.ADMIN, RoleName.ANALYST]);
      // Never AGENCY_OPERATOR or FIELD_REPORTER — bulk population data is
      // analyst-managed reference data (see controller's own comment).
      expect(roles).not.toContain(RoleName.AGENCY_OPERATOR);
      expect(roles).not.toContain(RoleName.FIELD_REPORTER);
    },
  );
});
