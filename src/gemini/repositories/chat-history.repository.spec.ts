import { ChatHistoryRepository } from './chat-history.repository';
import { SupabaseService } from '../../supabase/supabase.service';

/**
 * Builds a chainable mock matching the subset of supabase-js we actually use.
 * Each terminal call resolves with `result`; `eqCalls` records every .eq()
 * invocation so tests can assert ownership filters are applied.
 */
const buildSupabase = (
  result: { data?: unknown; error?: unknown },
  eqCalls: Array<[string, unknown]>,
) => {
  const builder = {
    select: jest.fn().mockImplementation(() => builder),
    eq: jest.fn().mockImplementation((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return builder;
    }),
    maybeSingle: jest.fn().mockResolvedValue(result),
    upsert: jest.fn().mockResolvedValue(result),
    delete: jest.fn().mockImplementation(() => builder),
    then: undefined as unknown,
  };
  // For the delete path the chain is `.from().delete().eq().eq()` and the
  // final `.eq()` is awaited as a thenable.
  const deletePromise: PromiseLike<typeof result> = {
    then: (onFulfilled) => Promise.resolve(result).then(onFulfilled),
  };
  builder.eq = jest.fn().mockImplementation((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return { ...builder, then: deletePromise.then };
  });

  const client = {
    from: jest.fn().mockReturnValue(builder),
  };
  return {
    service: { client } as unknown as SupabaseService,
    builder,
    client,
  };
};

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('ChatHistoryRepository', () => {
  describe('findByChatId', () => {
    it('filters by both chat_id and user_id', async () => {
      const eqCalls: Array<[string, unknown]> = [];
      const { service } = buildSupabase(
        {
          data: { messages: [{ role: 'user', parts: [{ text: 'hi' }] }] },
          error: null,
        },
        eqCalls,
      );
      const repo = new ChatHistoryRepository(service);

      const result = await repo.findByChatId(CHAT_ID, USER_A);

      expect(eqCalls).toEqual([
        ['chat_id', CHAT_ID],
        ['user_id', USER_A],
      ]);
      expect(result).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    });

    it('returns [] when the row does not match (existence is hidden)', async () => {
      const eqCalls: Array<[string, unknown]> = [];
      const { service } = buildSupabase({ data: null, error: null }, eqCalls);
      const repo = new ChatHistoryRepository(service);

      await expect(repo.findByChatId(CHAT_ID, USER_A)).resolves.toEqual([]);
    });
  });

  describe('checkOwnership', () => {
    it('returns "new" when no row exists', async () => {
      const eqCalls: Array<[string, unknown]> = [];
      const { service } = buildSupabase({ data: null, error: null }, eqCalls);
      const repo = new ChatHistoryRepository(service);

      await expect(repo.checkOwnership(CHAT_ID, USER_A)).resolves.toBe('new');
    });

    it('returns "owned" when row.user_id matches', async () => {
      const eqCalls: Array<[string, unknown]> = [];
      const { service } = buildSupabase(
        { data: { user_id: USER_A }, error: null },
        eqCalls,
      );
      const repo = new ChatHistoryRepository(service);

      await expect(repo.checkOwnership(CHAT_ID, USER_A)).resolves.toBe('owned');
    });

    it('returns "forbidden" when row.user_id belongs to a different user', async () => {
      const eqCalls: Array<[string, unknown]> = [];
      const { service } = buildSupabase(
        { data: { user_id: USER_B }, error: null },
        eqCalls,
      );
      const repo = new ChatHistoryRepository(service);

      await expect(repo.checkOwnership(CHAT_ID, USER_A)).resolves.toBe(
        'forbidden',
      );
    });
  });

  describe('clear', () => {
    it('deletes filtering by both chat_id and user_id', async () => {
      const eqCalls: Array<[string, unknown]> = [];
      const { service, builder } = buildSupabase(
        { data: null, error: null },
        eqCalls,
      );
      const repo = new ChatHistoryRepository(service);

      await repo.clear(CHAT_ID, USER_A);

      expect(builder.delete).toHaveBeenCalled();
      expect(eqCalls).toEqual([
        ['chat_id', CHAT_ID],
        ['user_id', USER_A],
      ]);
    });
  });
});
