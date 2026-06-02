import { describe, expect, it } from 'vitest';
import { token2022Decoder } from '../../src/decode/programs/token-2022.js';
import { pk, TOKEN_2022 } from '../helpers.js';
import type { CompiledInstructionView } from '../../src/index.js';

function ix(tag: number, body: number[], accounts: string[]): CompiledInstructionView {
  return {
    index: 0,
    programId: TOKEN_2022,
    accounts: accounts.map((p) => ({ pubkey: p, isSigner: false, isWritable: true })),
    data: new Uint8Array([tag, ...body]),
  };
}

function u64le(n: bigint): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...b];
}

describe('token-2022 decoder', () => {
  it('decodes base transfer via shared layout', () => {
    const out = token2022Decoder.decode(ix(3, u64le(42n), [pk(1), pk(2), pk(3)]));
    expect(out.program).toBe('Token-2022');
    expect(out.type).toBe('transfer');
    expect(out.effects?.[0]).toMatchObject({ kind: 'token-transfer', tokenProgram: 'token-2022' });
  });

  it('flags an extension instruction with token-2022-extension-unparsed (no throw)', () => {
    const out = token2022Decoder.decode(ix(26, [0, 0], [pk(1)])); // reallocate
    expect(out.decoded).toBe(false);
    expect(out.warningCode).toBe('token-2022-extension-unparsed');
    expect(out.type).toBe('reallocate');
  });

  it('decodes transferChecked via shared layout', () => {
    const out = token2022Decoder.decode(ix(12, [...u64le(7n), 9], [pk(1), pk(9), pk(2), pk(3)]));
    expect(out.type).toBe('transferChecked');
    expect(out.effects?.[0]).toMatchObject({ tokenProgram: 'token-2022', decimals: 9 });
  });
});
