import { of, throwError } from 'rxjs';
import { KarhutlaEngineClient } from './karhutla-engine.client';

function client(post: jest.Mock) {
  const http = { post } as never;
  const config = { get: jest.fn().mockReturnValue('x') } as never;
  return new KarhutlaEngineClient(http, config);
}

describe('KarhutlaEngineClient', () => {
  it('retries once after a timeout and returns the second response', async () => {
    const post = jest
      .fn()
      .mockReturnValueOnce(
        throwError(() => new Error('timeout of 45000ms exceeded')),
      )
      .mockReturnValueOnce(of({ data: { horizons: [] } }));
    await expect(client(post).predictFireSpread({} as never)).resolves.toEqual({
      horizons: [],
    });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry also times out', async () => {
    const post = jest
      .fn()
      .mockReturnValue(
        throwError(() => new Error('timeout of 45000ms exceeded')),
      );
    await expect(
      client(post).predictSmokeTransport({} as never),
    ).rejects.toThrow('timeout of 45000ms exceeded');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('does not retry engine 422s', async () => {
    const error = { response: { status: 422, data: { detail: 'bad' } } };
    const post = jest.fn().mockReturnValue(throwError(() => error));
    await expect(client(post).predictFireSpread({} as never)).rejects.toBe(
      error,
    );
    expect(post).toHaveBeenCalledTimes(1);
  });
});
