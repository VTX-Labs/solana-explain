import { describe, expect, it } from 'vitest';
import { decodeInstruction, defaultRegistry } from '../../src/decode/registry.js';
import { pk } from '../helpers.js';
import type { CompiledInstructionView } from '../../src/index.js';

const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const METAPLEX = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const STAKE = 'Stake11111111111111111111111111111111111111';

function view(programId: string): CompiledInstructionView {
  return { index: 0, programId, accounts: [{ pubkey: pk(1), isSigner: true, isWritable: true }], data: new Uint8Array([0, 1, 2]) };
}

describe('program recognition', () => {
  it('maps known program ids to names', () => {
    expect(decodeInstruction(view(JUPITER)).program).toBe('Jupiter v6');
    expect(decodeInstruction(view(METAPLEX)).program).toBe('Metaplex Token Metadata');
    expect(decodeInstruction(view(STAKE)).program).toBe('Stake');
  });

  it('recognized-but-undecoded programs are decoded:false and never throw', () => {
    const out = decodeInstruction(view(JUPITER));
    expect(out.decoded).toBe(false);
    expect(out.warning).toMatch(/inferred from balance diff/i);
  });

  it('unknown program id → decoded:false with no program name', () => {
    const unknown = pk(123);
    const out = decodeInstruction(view(unknown), defaultRegistry);
    expect(out.decoded).toBe(false);
    expect(out.program).toBeUndefined();
    expect(out.warning).toMatch(/unknown program/i);
  });
});
