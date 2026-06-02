import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { systemDecoder } from '../../src/decode/programs/system.js';
import { pk, viewOf, systemTransferIx, SYSTEM } from '../helpers.js';
import type { ExplainInstruction } from '../../src/index.js';

function createAccountIx(from: string, newAcc: string, lamports: bigint, space: bigint, owner: string): ExplainInstruction {
  const data = new Uint8Array(4 + 8 + 8 + 32);
  const view = new DataView(data.buffer);
  view.setUint32(0, 0, true);
  view.setBigUint64(4, lamports, true);
  view.setBigUint64(12, space, true);
  const ob = bs58.decode(owner);
  data.set(ob, 20);
  return {
    programId: SYSTEM,
    accounts: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: newAcc, isSigner: true, isWritable: true },
    ],
    data,
  };
}

describe('system decoder', () => {
  it('decodes transfer with correct lamports and effect', () => {
    const out = systemDecoder.decode(viewOf(systemTransferIx(pk(1), pk(2), 999n)));
    expect(out.decoded).toBe(true);
    expect(out.type).toBe('transfer');
    expect(out.args?.['lamports']).toBe('999');
    expect(out.effects?.[0]).toMatchObject({ kind: 'sol-transfer', lamports: 999n });
  });

  it('decodes createAccount with lamports/space/owner', () => {
    const owner = pk(9);
    const out = systemDecoder.decode(
      viewOf(createAccountIx(pk(3), pk(4), 1_000_000n, 165n, owner)),
    );
    expect(out.decoded).toBe(true);
    expect(out.type).toBe('createAccount');
    expect(out.args?.['lamports']).toBe('1000000');
    expect(out.args?.['space']).toBe('165');
    expect(out.args?.['owner']).toBe(owner);
    expect(out.effects?.[0]).toMatchObject({ kind: 'account-created', space: 165 });
  });

  it('decodes allocate', () => {
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, 8, true);
    view.setBigUint64(4, 200n, true);
    const out = systemDecoder.decode({
      index: 0,
      programId: SYSTEM,
      accounts: [{ pubkey: pk(1), isSigner: true, isWritable: true }],
      data,
    });
    expect(out.type).toBe('allocate');
    expect(out.args?.['space']).toBe('200');
  });

  it('returns not-decoded for too-short data', () => {
    const out = systemDecoder.decode({
      index: 0,
      programId: SYSTEM,
      accounts: [],
      data: new Uint8Array([1, 2]),
    });
    expect(out.decoded).toBe(false);
  });
});
