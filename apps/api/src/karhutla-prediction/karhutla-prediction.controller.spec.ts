import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { KarhutlaPredictionController } from './karhutla-prediction.controller';

function contextFor(handler: (...args: never[]) => unknown, role: RoleName) {
  return {
    getHandler: () => handler,
    getClass: () => KarhutlaPredictionController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  } as never;
}

describe('KarhutlaPredictionController authorization', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = KarhutlaPredictionController.prototype;

  it('requires JWT auth for every route', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      KarhutlaPredictionController,
    );
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('restricts starting a run to admins and agency operators', () => {
    expect(Reflect.getMetadata(ROLES_KEY, proto.requestRun)).toEqual([
      RoleName.ADMIN,
      RoleName.AGENCY_OPERATOR,
    ]);
    expect(
      guard.canActivate(contextFor(proto.requestRun, RoleName.AGENCY_OPERATOR)),
    ).toBe(true);
    expect(() =>
      guard.canActivate(contextFor(proto.requestRun, RoleName.FIELD_REPORTER)),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(contextFor(proto.requestRun, RoleName.ANALYST)),
    ).toThrow(ForbiddenException);
  });

  it('lets any signed-in role read forecasts', () => {
    for (const role of Object.values(RoleName)) {
      expect(guard.canActivate(contextFor(proto.latest, role))).toBe(true);
      expect(guard.canActivate(contextFor(proto.getRun, role))).toBe(true);
    }
  });

  it('audits manual run requests', async () => {
    const service = {
      requestRun: jest
        .fn()
        .mockResolvedValue({ run: { id: 'r1' }, deduplicated: false }),
    };
    const audit = { log: jest.fn() };
    const controller = new KarhutlaPredictionController(
      service as never,
      audit as never,
    );
    await controller.requestRun({ horizonsHours: [1, 3] }, {
      id: 'u1',
    } as never);
    expect(service.requestRun).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', horizonsHours: [1, 3] }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'karhutla.prediction.request',
        targetId: 'r1',
      }),
    );
  });
});
