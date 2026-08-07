import { SpatialIntelligenceService } from './spatial-intelligence.service';
import { OverlayLayer } from './dto/query-spatial-overlay.dto';

describe('SpatialIntelligenceService.getOverlay', () => {
  let districtRepository: { query: jest.Mock };
  let hazardEventRepository: { query: jest.Mock };
  let service: SpatialIntelligenceService;

  const districtRows = [
    {
      id: 'district-1',
      name: 'Kabupaten Test',
      geojson: JSON.stringify({ type: 'Point', coordinates: [110.2, -7.5] }),
    },
  ];

  beforeEach(() => {
    districtRepository = { query: jest.fn().mockResolvedValue(districtRows) };
    hazardEventRepository = { query: jest.fn() };

    service = new SpatialIntelligenceService(
      {} as any,
      {} as any,
      hazardEventRepository as any,
      districtRepository as any,
      {} as any,
      { emit: jest.fn() } as any,
    );
  });

  it('returns a GeoJSON FeatureCollection with one feature per district', async () => {
    hazardEventRepository.query.mockResolvedValue([]);

    const result = await service.getOverlay(OverlayLayer.RISK);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.districtId).toBe('district-1');
    expect(result.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [110.2, -7.5],
    });
  });

  it('joins the latest risk_assessments row per district for the risk layer', async () => {
    hazardEventRepository.query.mockResolvedValue([
      {
        districtId: 'district-1',
        riskScore: '72.50',
        exposureLevel: 'high',
        hazardType: 'earthquake',
        assessedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await service.getOverlay(OverlayLayer.RISK);

    expect(result.features[0].properties.riskScore).toBe(72.5);
    expect(result.features[0].properties.exposureLevel).toBe('high');
  });

  it('aggregates multiple indicators per district for the vulnerability layer', async () => {
    hazardEventRepository.query.mockResolvedValue([
      {
        districtId: 'district-1',
        indicatorType: 'building_quality',
        value: '65.0000',
        unit: 'index',
        year: 2025,
      },
      {
        districtId: 'district-1',
        indicatorType: 'poverty_rate',
        value: '12.0000',
        unit: 'percent',
        year: 2025,
      },
    ]);

    const result = await service.getOverlay(OverlayLayer.VULNERABILITY);

    const indicators = result.features[0].properties.indicators as Array<{
      type: string;
      value: number;
    }>;
    expect(indicators).toHaveLength(2);
    expect(indicators.map((i) => i.type).sort()).toEqual([
      'building_quality',
      'poverty_rate',
    ]);
  });

  it('scopes the district query to the given bbox when provided', async () => {
    hazardEventRepository.query.mockResolvedValue([]);

    await service.getOverlay(OverlayLayer.RISK, undefined, '100,-10,120,0');

    expect(districtRepository.query).toHaveBeenCalledWith(
      expect.stringContaining('ST_Intersects'),
      [100, -10, 120, 0],
    );
  });
});
