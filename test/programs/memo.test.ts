import { describe, expect, it } from 'vitest';
import { memoDecoder } from '../../src/decode/programs/memo.js';
import { MEMO } from '../helpers.js';
import type { CompiledInstructionView } from '../../src/index.js';

function memoView(data: Uint8Array): CompiledInstructionView {
  return { index: 0, programId: MEMO, accounts: [], data };
}

describe('memo decoder', () => {
  it('decodes valid UTF-8', () => {
    const out = memoDecoder.decode(memoView(new TextEncoder().encode('gm ☀️')));
    expect(out.type).toBe('memo');
    expect(out.args?.['text']).toBe('gm ☀️');
    expect(out.effects?.[0]).toMatchObject({ kind: 'memo' });
  });

  it('lossy-decodes invalid UTF-8 with replacement chars', () => {
    const out = memoDecoder.decode(memoView(new Uint8Array([0xff, 0xfe, 0x41])));
    expect(out.decoded).toBe(true);
    expect(String(out.args?.['text'])).toContain('A');
    // Replacement char U+FFFD present.
    expect(String(out.args?.['text'])).toMatch(/�/);
  });

  it('truncates huge memos and warns', () => {
    const big = 'x'.repeat(1000);
    const out = memoDecoder.decode(memoView(new TextEncoder().encode(big)));
    expect(String(out.args?.['text']).length).toBeLessThan(1000);
    expect(out.warningCode).toBe('partial-decode');
  });
});
