import { describe, expect, it } from 'vitest';
import { renderJson, renderMarkdown, renderText } from '../src/render/index.js';
import { stripAnsi } from '../src/render/ansi.js';
import { pk, USDC } from './helpers.js';
import type { ExplainResult } from '../src/index.js';

function sample(): ExplainResult {
  return {
    source: 'signature',
    signature: pk(1),
    success: true,
    slot: 287_330_114,
    blockTime: 1_717_000_000,
    feeLamports: 15000n,
    computeUnits: 142318,
    feePayer: pk(2),
    summary: 'Swapped 1.5 SOL for 248.91 USDC via Jupiter v6, paid 0.000015 SOL fee.',
    actions: [
      { kind: 'sol-transfer', from: pk(2), to: pk(3), lamports: 1_500_000_000n, sol: '1.5' },
      { kind: 'token-transfer', from: pk(4), to: pk(2), mint: USDC, amount: 248_910_000n, uiAmount: '248.91', decimals: 6, symbol: 'USDC', tokenProgram: 'spl-token' },
    ],
    balanceChanges: [
      { account: pk(2), asset: { kind: 'SOL' }, pre: 2_000_000_000n, post: 499_985_000n, delta: -1_500_015_000n, uiDelta: '-1.500015 SOL' },
      { account: pk(5), asset: { kind: 'token', mint: USDC, decimals: 6, symbol: 'USDC', tokenProgram: 'spl-token' }, owner: pk(2), pre: 0n, post: 248_910_000n, delta: 248_910_000n, uiDelta: '+248.91 USDC' },
    ],
    instructions: [
      { index: 0, programId: USDC, program: 'SPL Token', type: 'transferChecked', decoded: true, accounts: [], args: { amount: '248910000', decimals: 6 } },
    ],
    accountsCreated: [],
    approvals: [],
    programsInvoked: [
      { programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', name: 'Jupiter v6', count: 1 },
    ],
    warnings: [{ code: 'partial-decode', message: 'Jupiter route decoded best-effort (no IDL).' }],
  };
}

describe('renderJson', () => {
  it('serializes BigInt as decimal strings (no throw)', () => {
    const json = renderJson(sample(), { pretty: false });
    const parsed = JSON.parse(json);
    expect(parsed.feeLamports).toBe('15000');
    expect(parsed.balanceChanges[0].delta).toBe('-1500015000');
  });

  it('round-trips with pretty printing', () => {
    expect(() => JSON.parse(renderJson(sample(), { pretty: true }))).not.toThrow();
  });
});

describe('renderText', () => {
  it('emits no ANSI when color disabled', () => {
    const out = renderText(sample(), { color: false });
    expect(out).toBe(stripAnsi(out));
    expect(out).toMatch(/Summary/);
    expect(out).toMatch(/Balance changes/);
    expect(out).toMatch(/Jupiter v6/);
  });

  it('includes ANSI when color enabled', () => {
    const out = renderText(sample(), { color: true });
    expect(out).not.toBe(stripAnsi(out));
  });

  it('quiet mode returns only the summary', () => {
    const out = renderText(sample(), { quiet: true });
    expect(out).toBe(sample().summary);
  });

  it('verbose mode lists instructions', () => {
    const out = renderText(sample(), { color: false, verbose: true });
    expect(out).toMatch(/Instructions/);
    expect(out).toMatch(/transferChecked/);
  });
});

describe('renderMarkdown', () => {
  it('produces a valid markdown table for balance changes', () => {
    const md = renderMarkdown(sample());
    expect(md).toMatch(/\| Account \| Asset \| Change \|/);
    expect(md).toMatch(/\| --- \| --- \| --- \|/);
    expect(md).toMatch(/USDC/);
    expect(md).toMatch(/✅ Success/);
  });
});
