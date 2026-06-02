import { describe, expect, it } from 'vitest';
import { fromWeb3Rpc } from '../src/rpc/web3-adapter.js';

/** A jsonParsed SPL-token account, the shape getMultipleParsedAccounts returns. */
const parsedTokenAccount = {
  lamports: 2_039_280,
  owner: { toString: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
  data: {
    program: 'spl-token',
    parsed: {
      type: 'account',
      info: {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        owner: 'oWnEr11111111111111111111111111111111111111',
        tokenAmount: { amount: '1000000', decimals: 6 },
      },
    },
  },
  executable: false,
  rentEpoch: 0,
  space: 165,
};

describe('fromWeb3Rpc — kit RPC', () => {
  it('detects a kit RPC (getMultipleAccounts + .send) and parses token accounts', async () => {
    const kit = {
      getTransaction: () => ({ send: async () => null }),
      simulateTransaction: () => ({ send: async () => ({ value: {} }) }),
      getMultipleAccounts: (addrs: string[]) => ({
        send: async () => ({ value: addrs.map(() => parsedTokenAccount) }),
      }),
      getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: 'x', lastValidBlockHeight: 1 } }) }),
    };
    const client = fromWeb3Rpc(kit);
    const accounts = await client.getMultipleAccounts(['acc1'], { commitment: 'confirmed' });
    expect(accounts).toHaveLength(1);
    expect((accounts[0] as { data: { program: string } }).data.program).toBe('spl-token');
  });
});

describe('fromWeb3Rpc — v1 Connection', () => {
  function v1Conn(overrides: Record<string, unknown> = {}) {
    return {
      getTransaction: async () => null,
      simulateTransaction: async () => ({ value: {} }),
      getMultipleParsedAccounts: async (addrs: string[]) => ({
        value: addrs.map(() => parsedTokenAccount),
      }),
      getLatestBlockhash: async () => ({ blockhash: 'x', lastValidBlockHeight: 1 }),
      ...overrides,
    };
  }

  it('uses getMultipleParsedAccounts and preserves the jsonParsed shape (token deltas survive)', async () => {
    const client = fromWeb3Rpc(v1Conn());
    const accounts = await client.getMultipleAccounts(['acc1', 'acc2'], { commitment: 'confirmed' });
    expect(accounts).toHaveLength(2);
    const data = (accounts[0] as { data: { program: string; parsed: { info: { mint: string } } } }).data;
    expect(data.program).toBe('spl-token');
    expect(data.parsed.info.mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  it('coerces PublicKey owner objects to base58 strings', async () => {
    const client = fromWeb3Rpc(v1Conn());
    const accounts = await client.getMultipleAccounts(['acc1'], { commitment: 'confirmed' });
    expect((accounts[0] as { owner: string }).owner).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  });

  it('refuses a Buffer-only Connection instead of silently dropping token balances', async () => {
    // Only getMultipleAccountsInfo (returns raw Buffers) — must throw, not drop.
    const conn = {
      getTransaction: async () => null,
      getMultipleAccountsInfo: async () => [{ lamports: 1, owner: 'x', data: Buffer.from([]) }],
      getLatestBlockhash: async () => ({ blockhash: 'x', lastValidBlockHeight: 1 }),
    };
    const client = fromWeb3Rpc(conn);
    await expect(client.getMultipleAccounts(['acc1'], { commitment: 'confirmed' })).rejects.toThrow(
      /silently dropped|getMultipleParsedAccounts/,
    );
  });

  it('returns [] for an empty address list without calling the connection', async () => {
    const client = fromWeb3Rpc(v1Conn());
    expect(await client.getMultipleAccounts([], { commitment: 'confirmed' })).toEqual([]);
  });

  it('throws a clear error for a non-Connection object', () => {
    expect(() => fromWeb3Rpc(42 as unknown)).toThrow(/Connection or RPC object/);
    expect(() => fromWeb3Rpc({} as unknown)).toThrow();
  });
});
