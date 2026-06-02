import { describe, expect, it } from 'vitest';
import {
  explainInstructions,
  explainSignature,
  explainTransaction,
  RpcError,
  SolanaExplainError,
} from '../src/index.js';
import {
  buildSignatureResponse,
  compile,
  computeUnitLimitIx,
  memoIx,
  mockRpc,
  pk,
  systemTransferIx,
  tokenAccount,
  transferCheckedIx,
  SYSTEM,
  USDC,
  TOKEN,
} from './helpers.js';
import type { RawTokenBalance } from '../src/rpc/types.js';

const PAYER = pk(1);
const RECIPIENT = pk(2);

function tb(accountIndex: number, mint: string, owner: string, amount: string, decimals: number): RawTokenBalance {
  return { accountIndex, mint, owner, programId: TOKEN, uiTokenAmount: { amount, decimals, uiAmount: Number(amount) / 10 ** decimals } };
}

describe('explainSignature (fixture-driven)', () => {
  it('explains a simple SOL transfer', async () => {
    const { txBytes } = compile([systemTransferIx(PAYER, RECIPIENT, 1_000_000_000n)], PAYER);
    const resp = buildSignatureResponse({
      txBytes,
      accountKeys: [PAYER, RECIPIENT, SYSTEM],
      preBalances: [2_000_000_000, 0, 1],
      postBalances: [999_995_000, 1_000_000_000, 1],
      fee: 5000,
      computeUnitsConsumed: 150,
    });
    const rpc = mockRpc({ getTransaction: () => resp });
    const result = await explainSignature('sig', { rpc });

    expect(result.success).toBe(true);
    expect(result.source).toBe('signature');
    expect(result.feeLamports).toBe(5000n);
    expect(result.actions.some((a) => a.kind === 'sol-transfer')).toBe(true);
    expect(result.balanceChanges.length).toBeGreaterThan(0);
    expect(result.summary).toMatch(/SOL/);
  });

  it('explains an SPL transferChecked with mint/decimals from token balances', async () => {
    const srcAta = pk(10);
    const dstAta = pk(11);
    const { txBytes } = compile(
      [transferCheckedIx(srcAta, USDC, dstAta, PAYER, 250_000_000n, 6)],
      PAYER,
    );
    const resp = buildSignatureResponse({
      txBytes,
      accountKeys: [PAYER, srcAta, USDC, dstAta, TOKEN],
      preBalances: [2_000_000_000, 2_039_280, 1, 2_039_280, 1],
      postBalances: [1_999_995_000, 2_039_280, 1, 2_039_280, 1],
      preTokenBalances: [tb(1, USDC, PAYER, '500000000', 6), tb(3, USDC, RECIPIENT, '0', 6)],
      postTokenBalances: [tb(1, USDC, PAYER, '250000000', 6), tb(3, USDC, RECIPIENT, '250000000', 6)],
    });
    const rpc = mockRpc({ getTransaction: () => resp });
    const result = await explainSignature('sig', { rpc });

    expect(result.success).toBe(true);
    const tt = result.actions.find((a) => a.kind === 'token-transfer');
    expect(tt).toMatchObject({ amount: 250_000_000n, decimals: 6, symbol: 'USDC' });
    const usdcDelta = result.balanceChanges.find((d) => d.asset.kind === 'token');
    expect(usdcDelta?.uiDelta).toMatch(/USDC/);
  });

  it('a FAILED tx returns success:false with decoded error and does NOT throw', async () => {
    const { txBytes } = compile([systemTransferIx(PAYER, RECIPIENT, 1n)], PAYER);
    const resp = buildSignatureResponse({
      txBytes,
      accountKeys: [PAYER, RECIPIENT, SYSTEM],
      preBalances: [2_000_000_000, 0, 1],
      postBalances: [1_999_995_000, 0, 1], // fee charged, transfer reverted
      fee: 5000,
      err: { InstructionError: [0, { Custom: 6001 }] },
    });
    const rpc = mockRpc({ getTransaction: () => resp });
    const result = await explainSignature('sig', { rpc });

    expect(result.success).toBe(false);
    expect(result.error?.human).toMatch(/6001/);
    expect(result.feeLamports).toBe(5000n);
    // Fee delta still present.
    expect(result.balanceChanges.some((d) => d.account === PAYER)).toBe(true);
    expect(result.summary).toMatch(/FAILED/);
  });

  it('throws RpcError TX_NOT_FOUND (with commitment) when getTransaction returns null', async () => {
    const rpc = mockRpc({ getTransaction: () => null });
    await expect(explainSignature('sig', { rpc, commitment: 'finalized' })).rejects.toMatchObject({
      code: 'TX_NOT_FOUND',
    });
    try {
      await explainSignature('sig', { rpc, commitment: 'processed' });
    } catch (e) {
      expect((e as RpcError).message).toMatch(/processed/);
    }
  });

  it('explains a compute-budget + memo only tx (no balance effect)', async () => {
    const { txBytes } = compile([computeUnitLimitIx(200000), memoIx('gm frens')], PAYER);
    const resp = buildSignatureResponse({
      txBytes,
      accountKeys: [PAYER, 'ComputeBudget111111111111111111111111111111', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'],
      preBalances: [2_000_000_000, 1, 1],
      postBalances: [1_999_995_000, 1, 1],
      fee: 5000,
    });
    const rpc = mockRpc({ getTransaction: () => resp });
    const result = await explainSignature('sig', { rpc });
    expect(result.success).toBe(true);
    expect(result.actions.some((a) => a.kind === 'memo')).toBe(true);
    expect(result.actions.some((a) => a.kind === 'compute-budget')).toBe(true);
    expect(result.summary).toMatch(/memo|compute/i);
  });
});

describe('explainTransaction (simulate path)', () => {
  it('simulates a SOL transfer using pre/post snapshots', async () => {
    const { txBytes } = compile([systemTransferIx(PAYER, RECIPIENT, 1_000_000_000n)], PAYER);
    // Encode the same bytes as base64 for input.
    const base64 = Buffer.from(txBytes).toString('base64');

    const rpc = mockRpc({
      getMultipleAccounts: (addresses) =>
        addresses.map((a) => {
          if (a === PAYER) return { lamports: 2_000_000_000, owner: SYSTEM, executable: false, data: ['', 'base64'] };
          if (a === RECIPIENT) return { lamports: 0, owner: SYSTEM, executable: false, data: ['', 'base64'] };
          return null;
        }),
      simulateTransaction: () => ({
        context: { slot: 200 },
        value: {
          err: null,
          logs: ['Program 111 success'],
          unitsConsumed: 150,
          accounts: [
            { lamports: 999_995_000, owner: SYSTEM, executable: false, data: ['', 'base64'] },
            { lamports: 1_000_000_000, owner: SYSTEM, executable: false, data: ['', 'base64'] },
          ],
          innerInstructions: [],
        },
      }),
    });

    const result = await explainTransaction(base64, { rpc });
    expect(result.source).toBe('simulation');
    expect(result.success).toBe(true);
    expect(result.computeUnits).toBe(150);
    expect(result.balanceChanges.some((d) => d.delta < 0n)).toBe(true);
  });

  it('synthesizes token balances from jsonParsed account states', async () => {
    const srcAta = pk(10);
    const dstAta = pk(11);
    const { txBytes } = compile(
      [transferCheckedIx(srcAta, USDC, dstAta, PAYER, 100_000n, 6)],
      PAYER,
    );
    const base64 = Buffer.from(txBytes).toString('base64');

    const rpc = mockRpc({
      getMultipleAccounts: (addresses) =>
        addresses.map((a) => {
          if (a === srcAta) return tokenAccount(USDC, PAYER, '500000', 6);
          if (a === dstAta) return tokenAccount(USDC, RECIPIENT, '0', 6);
          if (a === PAYER) return { lamports: 2_000_000_000, owner: SYSTEM, executable: false, data: ['', 'base64'] };
          return null;
        }),
      simulateTransaction: () => ({
        context: { slot: 5 },
        value: {
          err: null,
          logs: [],
          unitsConsumed: 4000,
          accounts: [
            // order matches the unique writable list: payer, srcAta, dstAta
            { lamports: 2_000_000_000, owner: SYSTEM, executable: false, data: ['', 'base64'] },
            tokenAccount(USDC, PAYER, '400000', 6),
            tokenAccount(USDC, RECIPIENT, '100000', 6),
          ],
          innerInstructions: [],
        },
      }),
    });

    const result = await explainTransaction(base64, { rpc });
    const tokDeltas = result.balanceChanges.filter((d) => d.asset.kind === 'token');
    expect(tokDeltas.length).toBe(2);
    expect(result.actions.some((a) => a.kind === 'token-transfer')).toBe(true);
  });
});

describe('explainInstructions', () => {
  it('requires a feePayer', async () => {
    await expect(
      explainInstructions([systemTransferIx(PAYER, RECIPIENT, 1n)], {
        rpc: mockRpc({}),
        feePayer: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('assembles + simulates an instruction set', async () => {
    const rpc = mockRpc({
      getLatestBlockhash: () => ({ blockhash: SYSTEM, lastValidBlockHeight: 1 }),
      getMultipleAccounts: (addresses) =>
        addresses.map((a) =>
          a === PAYER
            ? { lamports: 2_000_000_000, owner: SYSTEM, executable: false, data: ['', 'base64'] as [string, string] }
            : { lamports: 0, owner: SYSTEM, executable: false, data: ['', 'base64'] as [string, string] },
        ),
      simulateTransaction: () => ({
        context: { slot: 1 },
        value: {
          err: null,
          logs: [],
          unitsConsumed: 150,
          accounts: [
            { lamports: 1_500_000_000, owner: SYSTEM, executable: false, data: ['', 'base64'] },
            { lamports: 500_000_000, owner: SYSTEM, executable: false, data: ['', 'base64'] },
          ],
          innerInstructions: [],
        },
      }),
    });
    const result = await explainInstructions([systemTransferIx(PAYER, RECIPIENT, 500_000_000n)], {
      rpc,
      feePayer: PAYER,
    });
    expect(result.source).toBe('simulation');
    expect(result.success).toBe(true);
  });
});

describe('error discipline', () => {
  it('all public async paths reject with a SolanaExplainError subclass', async () => {
    const cases: Promise<unknown>[] = [
      explainSignature('sig', { rpc: mockRpc({ getTransaction: () => null }) }),
      explainTransaction('!!!not valid!!!', { rpc: mockRpc({}) }),
      explainInstructions([], { rpc: mockRpc({}), feePayer: PAYER }),
    ];
    for (const p of cases) {
      await expect(p).rejects.toBeInstanceOf(SolanaExplainError);
    }
  });
});
