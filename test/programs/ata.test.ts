import { describe, expect, it } from 'vitest';
import { ataDecoder } from '../../src/decode/programs/ata.js';
import { pk, ATA, TOKEN, SYSTEM, USDC } from '../helpers.js';
import type { CompiledInstructionView } from '../../src/index.js';

function ataIx(data: Uint8Array, ata: string, owner: string): CompiledInstructionView {
  return {
    index: 0,
    programId: ATA,
    accounts: [
      { pubkey: pk(1), isSigner: true, isWritable: true }, // payer
      { pubkey: ata, isSigner: false, isWritable: true }, // ata
      { pubkey: owner, isSigner: false, isWritable: false }, // owner
      { pubkey: USDC, isSigner: false, isWritable: false }, // mint
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
      { pubkey: TOKEN, isSigner: false, isWritable: false },
    ],
    data,
  };
}

describe('ATA decoder', () => {
  it('legacy create (empty data) → account-created as:ata', () => {
    const out = ataDecoder.decode(ataIx(new Uint8Array(0), pk(2), pk(3)));
    expect(out.type).toBe('create');
    expect(out.effects?.[0]).toMatchObject({ kind: 'account-created', as: 'ata', address: pk(2) });
  });

  it('createIdempotent (tag 1)', () => {
    const out = ataDecoder.decode(ataIx(new Uint8Array([1]), pk(4), pk(5)));
    expect(out.type).toBe('createIdempotent');
    expect(out.effects?.[0]).toMatchObject({ as: 'ata' });
  });

  it('recoverNested (tag 2)', () => {
    const out = ataDecoder.decode(ataIx(new Uint8Array([2]), pk(6), pk(7)));
    expect(out.type).toBe('recoverNested');
    expect(out.decoded).toBe(true);
  });
});
