import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateKarhutlaRunDto } from './create-karhutla-run.dto';

const errorsFor = (body: unknown) =>
  validateSync(plainToInstance(CreateKarhutlaRunDto, body));

describe('CreateKarhutlaRunDto', () => {
  it('accepts an empty body and valid horizons', () => {
    expect(errorsFor({})).toHaveLength(0);
    expect(
      errorsFor({ horizonsHours: [1, 3, 6], maxClusters: 4 }),
    ).toHaveLength(0);
  });

  it.each([
    [{ horizonsHours: [0] }],
    [{ horizonsHours: [13] }],
    [{ horizonsHours: [1, 1] }],
    [{ horizonsHours: [] }],
    [{ horizonsHours: [1, 2, 3, 4, 5, 6, 7] }],
    [{ horizonsHours: [1.5] }],
    [{ maxClusters: 0 }],
    [{ maxClusters: 50 }],
  ])('rejects %j', (body) => {
    expect(errorsFor(body).length).toBeGreaterThan(0);
  });
});
