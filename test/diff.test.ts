import { describe, expect, it } from 'vitest';
import { diffBalances } from '../src/explain/diff.js';
import { pk, USDC } from './helpers.js';
import type { BalanceSnapshot } from '../src/index.js';

const A = pk(1);
const B = pk(2);

function snap(
  lamports: Record<string, bigint>,
  tokens: { account: string; mint: string; owner?: string; amount: bigint; decimals: number; symbol?: string }[] = [],
): BalanceSnapshot {
  const accountKeys = Object.keys(lamports);
  return {
    accountKeys,
    lamports: accountKeys.map((k) => lamports[k]!),
    tokenBalances: tokens.map((t) => ({ ...t, tokenProgram: 'spl-token' })),
  };
}

describe('diffBalances', () => {
  it('computes signed SOL deltas by account', () => {
    const pre = snap({ [A]: 10n, [B]: 0n });
    const post = snap({ [A]: 7n, [B]: 3n });
    const deltas = diffBalances(pre, post);
    const a = deltas.find((d) => d.account === A)!;
    const b = deltas.find((d) => d.account === B)!;
    expect(a.delta).toBe(-3n);
    expect(b.delta).toBe(3n);
  });

  it('matches token deltas by account+mint', () => {
    const pre = snap({ [A]: 0n }, [{ account: pk(5), mint: USDC, owner: A, amount: 1_000_000n, decimals: 6, symbol: 'USDC' }]);
    const post = snap({ [A]: 0n }, [{ account: pk(5), mint: USDC, owner: A, amount: 1_250_000n, decimals: 6, symbol: 'USDC' }]);
    const deltas = diffBalances(pre, post);
    const tok = deltas.find((d) => d.asset.kind === 'token')!;
    expect(tok.delta).toBe(250_000n);
    expect(tok.uiDelta).toBe('+0.25 USDC');
  });

  it('treats post-only token accounts as created (pre 0)', () => {
    const pre = snap({ [A]: 0n }, []);
    const post = snap({ [A]: 0n }, [{ account: pk(6), mint: USDC, owner: A, amount: 5n, decimals: 6 }]);
    const deltas = diffBalances(pre, post);
    const tok = deltas.find((d) => d.asset.kind === 'token')!;
    expect(tok.pre).toBe(0n);
    expect(tok.delta).toBe(5n);
  });

  it('treats pre-only (closed) accounts as drained', () => {
    const pre = snap({ [A]: 2_039_280n });
    const post = snap({}); // A vanished
    const deltas = diffBalances(pre, post);
    const a = deltas.find((d) => d.account === A)!;
    expect(a.delta).toBe(-2_039_280n);
  });

  it('self-transfer nets to zero (no delta entry)', () => {
    const pre = snap({ [A]: 100n });
    const post = snap({ [A]: 100n });
    const deltas = diffBalances(pre, post);
    expect(deltas.find((d) => d.account === A)).toBeUndefined();
  });
});
