import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RoleName } from '../common/enums/roles.enum';
import { RainfallController } from './rainfall.controller';

function contextFor(handler: (...args: never[]) => unknown, role: RoleName) {
  return {
    getHandler: () => handler,
    getClass: () => RainfallController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  } as never;
}

describe('RainfallController', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = RainfallController.prototype;

  it('requires JWT auth for every route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RainfallController)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
  });

  it('lets any signed-in role read conditions', () => {
    for (const role of Object.values(RoleName)) {
      expect(guard.canActivate(contextFor(proto.listConditions, role))).toBe(
        true,
      );
      expect(guard.canActivate(contextFor(proto.getConditions, role))).toBe(
        true,
      );
    }
  });

  it('restricts manual ingestion to admins and agency operators', () => {
    expect(Reflect.getMetadata(ROLES_KEY, proto.runIngestion)).toEqual([
      RoleName.ADMIN,
      RoleName.AGENCY_OPERATOR,
    ]);
    expect(() =>
      guard.canActivate(contextFor(proto.runIngestion, RoleName.ANALYST)),
    ).toThrow(ForbiddenException);
  });

  it('audits a manual ingestion run', async () => {
    const ingestion = {
      ingest: jest.fn().mockResolvedValue({ samplesWritten: 10 }),
    };
    const audit = { log: jest.fn() };
    const controller = new RainfallController(
      {} as never,
      ingestion as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
    );
    await expect(
      controller.runIngestion({ id: 'u1' } as never),
    ).resolves.toEqual({ samplesWritten: 10 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'u1',
        action: 'rainfall.ingestion.run',
      }),
    );
  });

  it('returns 409 while a run is already in progress', async () => {
    const ingestion = { ingest: jest.fn().mockResolvedValue(null) };
    const audit = { log: jest.fn() };
    const controller = new RainfallController(
      {} as never,
      ingestion as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
    );
    await expect(
      controller.runIngestion({ id: 'u1' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('lets any signed-in role read ingestion status', () => {
    for (const role of Object.values(RoleName)) {
      expect(
        guard.canActivate(contextFor(proto.getIngestionStatus, role)),
      ).toBe(true);
    }
  });

  describe('GSMaP runs', () => {
    function controllerWith(gsmap: Record<string, jest.Mock>) {
      const audit = { log: jest.fn() };
      const controller = new RainfallController(
        {} as never,
        {} as never,
        gsmap as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        audit as never,
      );
      return { controller, audit };
    }

    it('is restricted to admins and agency operators', () => {
      expect(Reflect.getMetadata(ROLES_KEY, proto.runGsmapIngestion)).toEqual([
        RoleName.ADMIN,
        RoleName.AGENCY_OPERATOR,
      ]);
    });

    it('starts a background run and audits it', async () => {
      const { controller, audit } = controllerWith({
        isConfigured: jest.fn().mockReturnValue(true),
        startInBackground: jest.fn().mockReturnValue(true),
      });
      await expect(
        controller.runGsmapIngestion({ id: 'u1' } as never),
      ).resolves.toEqual({ accepted: true });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'rainfall.gsmap_ingestion.start' }),
      );
    });

    it('returns 409 without credentials or while a run is in progress', async () => {
      const unconfigured = controllerWith({
        isConfigured: jest.fn().mockReturnValue(false),
        startInBackground: jest.fn(),
      });
      await expect(
        unconfigured.controller.runGsmapIngestion({ id: 'u1' } as never),
      ).rejects.toThrow(/not configured/);

      const busy = controllerWith({
        isConfigured: jest.fn().mockReturnValue(true),
        startInBackground: jest.fn().mockReturnValue(false),
      });
      await expect(
        busy.controller.runGsmapIngestion({ id: 'u1' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(busy.audit.log).not.toHaveBeenCalled();
    });
  });

  describe('nowcasts', () => {
    function controllerWith(
      nowcast: Record<string, jest.Mock>,
      backtest: Record<string, jest.Mock> = {},
    ) {
      const audit = { log: jest.fn() };
      const controller = new RainfallController(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        nowcast as never,
        backtest as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        audit as never,
      );
      return { controller, audit };
    }

    it('lets any signed-in role read nowcasts and backtests', () => {
      for (const role of Object.values(RoleName)) {
        for (const handler of [
          proto.latestNowcast,
          proto.latestNowcastForDistrict,
          proto.latestBacktest,
        ]) {
          expect(guard.canActivate(contextFor(handler, role))).toBe(true);
        }
      }
    });

    it('restricts starting runs and backtests to admins and agency operators', () => {
      for (const handler of [proto.runNowcast, proto.runBacktest]) {
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
          RoleName.ADMIN,
          RoleName.AGENCY_OPERATOR,
        ]);
      }
    });

    it('audits a manual nowcast run and returns it', async () => {
      const { controller, audit } = controllerWith({
        run: jest.fn().mockResolvedValue({ id: 'r1', status: 'completed' }),
      });
      await expect(
        controller.runNowcast({ id: 'u1' } as never),
      ).resolves.toEqual({ id: 'r1', status: 'completed' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'rainfall.nowcast.run',
          targetId: 'r1',
        }),
      );
    });

    it('returns 409 for a concurrent nowcast or backtest', async () => {
      const { controller } = controllerWith(
        { run: jest.fn().mockResolvedValue(null) },
        { startInBackground: jest.fn().mockReturnValue(false) },
      );
      await expect(
        controller.runNowcast({ id: 'u1' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        controller.runBacktest({ hours: 24 }, { id: 'u1' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('starts a background backtest', async () => {
      const startInBackground = jest.fn().mockReturnValue(true);
      const { controller } = controllerWith({}, { startInBackground });
      await expect(
        controller.runBacktest({ hours: 12 }, { id: 'u1' } as never),
      ).resolves.toEqual({ accepted: true, hours: 12 });
      expect(startInBackground).toHaveBeenCalledWith(12);
    });
  });

  describe('flood risk', () => {
    function controllerWith(
      floodRisk: Record<string, jest.Mock>,
      hazardIndex: Record<string, jest.Mock> = {},
    ) {
      const audit = { log: jest.fn() };
      const controller = new RainfallController(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        floodRisk as never,
        hazardIndex as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        audit as never,
      );
      return { controller, audit };
    }

    it('lets any signed-in role read flood risk', () => {
      for (const role of Object.values(RoleName)) {
        for (const handler of [
          proto.latestFloodRisk,
          proto.latestFloodRiskForDistrict,
        ]) {
          expect(guard.canActivate(contextFor(handler, role))).toBe(true);
        }
      }
    });

    it('restricts runs and index refreshes to admins and agency operators', () => {
      for (const handler of [proto.runFloodRisk, proto.refreshHazardIndices]) {
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
          RoleName.ADMIN,
          RoleName.AGENCY_OPERATOR,
        ]);
      }
    });

    it('audits a manual flood risk run', async () => {
      const { controller, audit } = controllerWith({
        run: jest.fn().mockResolvedValue({ id: 'f1', status: 'completed' }),
      });
      await expect(
        controller.runFloodRisk({ id: 'u1' } as never),
      ).resolves.toEqual({ id: 'f1', status: 'completed' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'rainfall.flood_risk.run',
          targetId: 'f1',
        }),
      );
    });

    it('returns 409 for concurrent runs and refreshes', async () => {
      const { controller, audit } = controllerWith(
        { run: jest.fn().mockResolvedValue(null) },
        { startInBackground: jest.fn().mockReturnValue(false) },
      );
      await expect(
        controller.runFloodRisk({ id: 'u1' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        controller.refreshHazardIndices({ id: 'u1' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('landslide risk', () => {
    function controllerWith(
      landslideRisk: Record<string, jest.Mock>,
      terrain: Record<string, jest.Mock> = {},
    ) {
      const audit = { log: jest.fn() };
      const controller = new RainfallController(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        landslideRisk as never,
        terrain as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        audit as never,
      );
      return { controller, audit };
    }

    it('lets any signed-in role read landslide risk', () => {
      for (const role of Object.values(RoleName)) {
        for (const handler of [
          proto.latestLandslideRisk,
          proto.latestLandslideRiskForDistrict,
        ]) {
          expect(guard.canActivate(contextFor(handler, role))).toBe(true);
        }
      }
    });

    it('restricts runs and terrain refreshes to admins and agency operators', () => {
      for (const handler of [proto.runLandslideRisk, proto.refreshTerrain]) {
        expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
          RoleName.ADMIN,
          RoleName.AGENCY_OPERATOR,
        ]);
      }
    });

    it('audits a manual landslide risk run', async () => {
      const { controller, audit } = controllerWith({
        run: jest.fn().mockResolvedValue({ id: 'l1', status: 'completed' }),
      });
      await expect(
        controller.runLandslideRisk({ id: 'u1' } as never),
      ).resolves.toEqual({ id: 'l1', status: 'completed' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'rainfall.landslide_risk.run',
          targetId: 'l1',
        }),
      );
    });

    it('returns 409 for concurrent runs and refreshes', async () => {
      const { controller, audit } = controllerWith(
        { run: jest.fn().mockResolvedValue(null) },
        { startInBackground: jest.fn().mockReturnValue(false) },
      );
      await expect(
        controller.runLandslideRisk({ id: 'u1' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        controller.refreshTerrain({ id: 'u1' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('spatial model', () => {
    function controllerWith(spatialModel: Record<string, jest.Mock>) {
      const audit = { log: jest.fn() };
      const controller = new RainfallController(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        spatialModel as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        audit as never,
      );
      return { controller, audit };
    }

    it('lets any signed-in role read the latest training run', () => {
      for (const role of Object.values(RoleName)) {
        expect(
          guard.canActivate(contextFor(proto.latestSpatialModel, role)),
        ).toBe(true);
      }
    });

    it('restricts training to admins and agency operators', () => {
      expect(Reflect.getMetadata(ROLES_KEY, proto.trainSpatialModel)).toEqual([
        RoleName.ADMIN,
        RoleName.AGENCY_OPERATOR,
      ]);
    });

    it('starts training in the background, audits it, and 409s when busy', async () => {
      const startInBackground = jest
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      const { controller, audit } = controllerWith({ startInBackground });
      await expect(
        controller.trainSpatialModel({ id: 'u1' } as never),
      ).resolves.toEqual({ accepted: true });
      expect(startInBackground).toHaveBeenCalledWith('manual');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'rainfall.spatial_model.train' }),
      );
      await expect(
        controller.trainSpatialModel({ id: 'u1' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('outlook', () => {
    it('lets any signed-in role read the outlook', () => {
      for (const role of Object.values(RoleName)) {
        for (const handler of [proto.outlook, proto.outlookForDistrict]) {
          expect(guard.canActivate(contextFor(handler, role))).toBe(true);
        }
      }
    });
  });
});
