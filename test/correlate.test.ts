import { describe, expect, it } from 'vitest';
import { correlate } from '../src/explain/correlate.js';
import { defaultRegistry } from '../src/decode/registry.js';
import {
  pk,
  viewOf,
  transferCheckedIx,
  systemTransferIx,
  USDC,
  TOKEN,
} from './helpers.js';
import type { BalanceDelta, CompiledInstructionView, TokenBalanceEntry } from '../src/index.js';

describe('correlate', () => {
  it('decoded transferChecked + matching delta → single token-transfer action', () => {
    const src = pk(10);
    const dst = pk(11);
    const ix = viewOf(transferCheckedIx(src, USDC, dst, pk(12), 250_000n, 6));
    const tokenBalances: TokenBalanceEntry[] = [
      { account: src, mint: USDC, owner: pk(1), amount: 0n, decimals: 6, tokenProgram: 'spl-token' },
      { account: dst, mint: USDC, owner: pk(2), amount: 250_000n, decimals: 6, tokenProgram: 'spl-token' },
    ];
    const out = correlate({
      instructions: [ix],
      deltas: [],
      tokenBalances,
      registry: defaultRegistry,
    });
    const transfers = out.actions.filter((a) => a.kind === 'token-transfer');
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ amount: 250_000n, decimals: 6, symbol: 'USDC' });
  });

  it('unknown swap program + net deltas → program-call action narrated best-effort', () => {
    const jup: CompiledInstructionView = {
      index: 0,
      programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      accounts: [{ pubkey: pk(1), isSigner: true, isWritable: true }],
      data: new Uint8Array([1, 2, 3]),
    };
    const deltas: BalanceDelta[] = [
      { account: pk(1), asset: { kind: 'SOL' }, pre: 10n, post: 5n, delta: -5n, uiDelta: '-5 SOL' },
    ];
    const out = correlate({ instructions: [jup], deltas, tokenBalances: [], registry: defaultRegistry });
    const call = out.actions.find((a) => a.kind === 'program-call');
    expect(call).toBeDefined();
    if (call && call.kind === 'program-call') {
      expect(call.program).toBe('Jupiter v6');
      expect(call.note).toMatch(/balance diff/i);
    }
    expect(out.warnings.some((w) => w.code === 'partial-decode')).toBe(true);
  });

  it('produces sol-transfer action for decoded System.transfer', () => {
    const ix = viewOf(systemTransferIx(pk(1), pk(2), 1_500_000_000n));
    const out = correlate({ instructions: [ix], deltas: [], tokenBalances: [], registry: defaultRegistry });
    const t = out.actions.find((a) => a.kind === 'sol-transfer');
    expect(t).toMatchObject({ kind: 'sol-transfer', lamports: 1_500_000_000n, sol: '1.5' });
  });

  it('counts program invocations', () => {
    const ix1 = viewOf(systemTransferIx(pk(1), pk(2), 1n));
    const ix2 = viewOf(systemTransferIx(pk(1), pk(3), 2n), 1);
    const out = correlate({ instructions: [ix1, ix2], deltas: [], tokenBalances: [], registry: defaultRegistry });
    const sys = out.programsInvoked.find((p) => p.name === 'System');
    expect(sys?.count).toBe(2);
  });

  it('flags self-transfer with a warning', () => {
    const self = pk(20);
    const ix = viewOf(transferCheckedIx(self, USDC, self, pk(21), 1n, 6));
    const tokenBalances: TokenBalanceEntry[] = [
      { account: self, mint: USDC, owner: pk(1), amount: 1n, decimals: 6, tokenProgram: 'spl-token' },
    ];
    const out = correlate({ instructions: [ix], deltas: [], tokenBalances, registry: defaultRegistry });
    expect(out.warnings.some((w) => w.message.includes('self-transfer'))).toBe(true);
  });

  it('tokenProgram propagates for token program transfers', () => {
    void TOKEN;
    const ix = viewOf(transferCheckedIx(pk(1), USDC, pk(2), pk(3), 5n, 6));
    const out = correlate({ instructions: [ix], deltas: [], tokenBalances: [], registry: defaultRegistry });
    const t = out.actions.find((a) => a.kind === 'token-transfer');
    expect(t && t.kind === 'token-transfer' ? t.tokenProgram : null).toBe('spl-token');
  });
});
