import { ImportProcessor } from './import.processor';
import { PopulationImportBatchStatus } from '../../common/enums/domain.enum';

// Regression test for a real bug found live in the 100k-row e2e test:
// `process()`'s loop queried `MoreThan(batch.lastImportedRowNumber)` every
// iteration, but the transaction that commits a chunk's checkpoint to the
// DATABASE never updated the in-memory `batch` object — so every
// iteration re-queried with the SAME stale cursor and re-fetched the
// identical first chunk forever, burning CPU and never finishing. Fixed
// by assigning `batch.lastImportedRowNumber = checkpoint` after each
// chunk's transaction commits.
describe('ImportProcessor.process — checkpoint cursor advances every iteration', () => {
  it('never re-queries with the same MoreThan(cursor) value twice in a row', async () => {
    const rowsChunk1 = [1, 2].map((rowNumber) => ({
      rowNumber,
      status: 'invalid', // non-candidate: importChunk() short-circuits with no DB writes needed
      matchedVillage: null,
    }));
    const rowsChunk2 = [3, 4].map((rowNumber) => ({
      rowNumber,
      status: 'invalid',
      matchedVillage: null,
    }));

    const findCalls: number[] = [];
    const rowRepository = {
      find: jest.fn(async ({ where }: any) => {
        findCalls.push(where.rowNumber.value);
        if (findCalls.length === 1) return rowsChunk1;
        if (findCalls.length === 2) return rowsChunk2;
        return [];
      }),
      save: jest.fn(),
    };
    const batchRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'batch-1',
        status: PopulationImportBatchStatus.QUEUED,
        lastImportedRowNumber: null,
      }),
      save: jest.fn(async (b: any) => b),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: any) => {
        const manager = {
          update: jest.fn(),
          query: jest.fn().mockResolvedValue([]),
        };
        await cb(manager);
      }),
      query: jest.fn().mockResolvedValue([]), // used by finalize()'s status-count summary
    };
    const config = { get: jest.fn().mockReturnValue(2) }; // chunkSize = 2

    const processor = new ImportProcessor(
      batchRepository as any,
      rowRepository as any,
      dataSource as any,
      config as any,
    );

    const job = {
      data: { batchId: 'batch-1' },
      id: 'job-1',
      updateProgress: jest.fn(),
    };

    await processor.process(job as any);

    // Three find() calls: cursor 0 (chunk1), cursor 2 (chunk2, chunk1's
    // last rowNumber — proves it advanced), cursor 4 (empty, loop ends).
    expect(findCalls).toEqual([0, 2, 4]);
    expect(rowRepository.find).toHaveBeenCalledTimes(3);
  });
});
