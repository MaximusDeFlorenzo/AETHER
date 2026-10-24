import { of, throwError } from 'rxjs';
import { BnpbInariskClient } from './bnpb-inarisk.client';

function build(get: jest.Mock) {
  return new BnpbInariskClient(
    { get } as never,
    { get: jest.fn().mockReturnValue(undefined) } as never,
  );
}

describe('BnpbInariskClient', () => {
  it('sends an identifying User-Agent (the server 403s axios default) and parses the value', async () => {
    const get = jest
      .fn()
      .mockReturnValue(of({ data: { samples: [{ value: '0.370370388' }] } }));
    await expect(
      build(get).getIndexValue('INDEKS_BAHAYA_BANJIR', 106.8, -6.2),
    ).resolves.toBeCloseTo(0.37037);
    const [url, options] = get.mock.calls[0];
    expect(url).toContain('/INDEKS_BAHAYA_BANJIR/ImageServer/getSamples');
    expect(options.headers['User-Agent']).toMatch(/^AETHER\//);
    // Geometry is pre-projected to EPSG:3395 metres, not raw lon/lat.
    expect(JSON.parse(options.params.geometry).x).toBeCloseTo(11888921.6, 0);
  });

  it('tells an answered NoData pixel apart from a failed request', async () => {
    const noData = jest
      .fn()
      .mockReturnValue(of({ data: { samples: [{ value: '' }] } }));
    await expect(build(noData).lookupIndexValue('L', 1, 1)).resolves.toEqual({
      value: null,
      failed: false,
    });
    const failing = jest
      .fn()
      .mockReturnValue(throwError(() => new Error('timeout')));
    await expect(build(failing).lookupIndexValue('L', 1, 1)).resolves.toEqual({
      value: null,
      failed: true,
    });
    const errorBody = jest
      .fn()
      .mockReturnValue(of({ data: { error: { code: 500 } } }));
    await expect(build(errorBody).lookupIndexValue('L', 1, 1)).resolves.toEqual(
      { value: null, failed: true },
    );
  });

  it('returns null for NoData and on request failure', async () => {
    const noData = jest
      .fn()
      .mockReturnValue(of({ data: { samples: [{ value: 'NoData' }] } }));
    await expect(build(noData).getIndexValue('L', 1, 1)).resolves.toBeNull();
    const failing = jest
      .fn()
      .mockReturnValue(throwError(() => new Error('403')));
    await expect(build(failing).getIndexValue('L', 1, 1)).resolves.toBeNull();
  });
});
