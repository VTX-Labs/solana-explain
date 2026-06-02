import { describe, expect, it } from 'vitest';
import { summarize } from '../src/explain/summarize.js';
import { pk, USDC } from './helpers.js';
import type { Action, BalanceDelta, ProgramInvocation } from '../src/index.js';

const FEE_PAYER = pk(1);

describe('summarize', () => {
  it('prefers swap over transfer when a DEX is involved', () => {
    const actions: Action[] = [
      { kind: 'token-transfer', from: pk(2), to: pk(3), mint: USDC, amount: 248_910_000n, uiAmount: '248.91', decimals: 6, symbol: 'USDC', tokenProgram: 'spl-token' },
    ];
    const deltas: BalanceDelta[] = [
      { account: FEE_PAYER, asset: { kind: 'SOL' }, pre: 2_000_000_000n, post: 500_000_000n, delta: -1_500_000_000n, uiDelta: '-1.5 SOL' },
      { account: pk(5), asset: { kind: 'token', mint: USDC, decimals: 6, symbol: 'USDC', tokenProgram: 'spl-token' }, owner: FEE_PAYER, pre: 0n, post: 248_910_000n, delta: 248_910_000n, uiDelta: '+248.91 USDC' },
    ];
    const programsInvoked: ProgramInvocation[] = [
      { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', name: 'Jupiter v6', count: 1 },
    ];
    const s = summarize({ actions, deltas, programsInvoked, feePayer: FEE_PAYER, feeLamports: 5000n, success: true });
    expect(s).toMatch(/Swapped/);
    expect(s).toMatch(/Jupiter v6/);
    expect(s).toMatch(/USDC/);
  });

  it('phrases from focusAccount when provided', () => {
    const focus = pk(9);
    const deltas: BalanceDelta[] = [
      { account: focus, asset: { kind: 'SOL' }, pre: 10n, post: 5n, delta: -5n, uiDelta: '-5 SOL' },
      { account: pk(8), asset: { kind: 'token', mint: USDC, decimals: 6, symbol: 'USDC', tokenProgram: 'spl-token' }, owner: focus, pre: 0n, post: 100n, delta: 100n, uiDelta: '+0.0001 USDC' },
    ];
    const s = summarize({
      actions: [],
      deltas,
      programsInvoked: [{ programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', name: 'Orca Whirlpool', count: 1 }],
      feePayer: FEE_PAYER,
      feeLamports: 0n,
      success: true,
      focusAccount: focus,
    });
    expect(s).toMatch(/Orca Whirlpool|Swapped|Routed/);
  });

  it('describes a failed tx with the human error and fee note', () => {
    const s = summarize({
      actions: [],
      deltas: [],
      programsInvoked: [],
      feePayer: FEE_PAYER,
      feeLamports: 5000n,
      success: false,
      error: { human: 'instruction #1 failed with custom program error 6001' },
    });
    expect(s).toMatch(/FAILED/);
    expect(s).toMatch(/6001/);
    expect(s).toMatch(/fee/i);
  });

  it('gives a sensible summary for compute-only tx', () => {
    const s = summarize({
      actions: [{ kind: 'compute-budget', unitLimit: 200000 }],
      deltas: [],
      programsInvoked: [{ programId: 'ComputeBudget111111111111111111111111111111', name: 'Compute Budget', count: 1 }],
      feePayer: FEE_PAYER,
      feeLamports: 5000n,
      success: true,
    });
    expect(s).toMatch(/compute budget/i);
  });

  it('summarizes a memo-only tx', () => {
    const s = summarize({
      actions: [{ kind: 'memo', text: 'gm' }],
      deltas: [],
      programsInvoked: [],
      feePayer: FEE_PAYER,
      feeLamports: 5000n,
      success: true,
    });
    expect(s).toMatch(/memo/i);
    expect(s).toMatch(/gm/);
  });

  it('summarizes a plain SOL transfer', () => {
    const s = summarize({
      actions: [{ kind: 'sol-transfer', from: FEE_PAYER, to: pk(2), lamports: 1_000_000_000n, sol: '1' }],
      deltas: [{ account: FEE_PAYER, asset: { kind: 'SOL' }, pre: 2_000_000_000n, post: 1_000_000_000n, delta: -1_000_000_000n, uiDelta: '-1 SOL' }],
      programsInvoked: [{ programId: '11111111111111111111111111111111', name: 'System', count: 1 }],
      feePayer: FEE_PAYER,
      feeLamports: 5000n,
      success: true,
    });
    expect(s).toMatch(/Sent 1 SOL/);
  });
});
