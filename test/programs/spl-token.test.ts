import { describe, expect, it } from 'vitest';
import { splTokenDecoder } from '../../src/decode/programs/token-2022.js';
import { decodeTokenInstruction } from '../../src/decode/programs/spl-token.js';
import { pk, viewOf, transferCheckedIx, TOKEN } from '../helpers.js';
import type { CompiledInstructionView } from '../../src/index.js';

function tokenIx(tag: number, body: number[], accounts: string[]): CompiledInstructionView {
  return {
    index: 0,
    programId: TOKEN,
    accounts: accounts.map((p, i) => ({ pubkey: p, isSigner: i === accounts.length - 1, isWritable: i < 2 })),
    data: new Uint8Array([tag, ...body]),
  };
}

function u64le(n: bigint): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...b];
}

describe('spl-token decoder', () => {
  it('decodes transfer (3) amount as bigint with ambiguous-amount warning', () => {
    const out = decodeTokenInstruction(
      tokenIx(3, u64le(500n), [pk(1), pk(2), pk(3)]),
      'SPL Token',
      'spl-token',
    );
    expect(out.type).toBe('transfer');
    expect(out.effects?.[0]).toMatchObject({ kind: 'token-transfer', amount: 500n });
    expect(out.warningCode).toBe('ambiguous-amount');
  });

  it('decodes transferChecked (12) with mint + decimals', () => {
    const out = splTokenDecoder.decode(
      viewOf(transferCheckedIx(pk(1), pk(9), pk(2), pk(3), 250_000_000n, 6)),
    );
    expect(out.type).toBe('transferChecked');
    expect(out.args?.['decimals']).toBe(6);
    expect(out.effects?.[0]).toMatchObject({
      kind: 'token-transfer',
      amount: 250_000_000n,
      decimals: 6,
      mint: pk(9),
    });
  });

  it('decodes approve (4) and revoke (5)', () => {
    const approve = decodeTokenInstruction(
      tokenIx(4, u64le(100n), [pk(1), pk(2), pk(3)]),
      'SPL Token',
      'spl-token',
    );
    expect(approve.type).toBe('approve');
    expect(approve.effects?.[0]).toMatchObject({ kind: 'approval', amount: 100n });

    const revoke = decodeTokenInstruction(
      tokenIx(5, [], [pk(1), pk(2)]),
      'SPL Token',
      'spl-token',
    );
    expect(revoke.type).toBe('revoke');
    expect(revoke.effects?.[0]).toMatchObject({ kind: 'approval', revoke: true });
  });

  it('approve with max u64 → unlimited', () => {
    const max = (1n << 64n) - 1n;
    const out = decodeTokenInstruction(
      tokenIx(4, u64le(max), [pk(1), pk(2), pk(3)]),
      'SPL Token',
      'spl-token',
    );
    expect(out.effects?.[0]).toMatchObject({ kind: 'approval', amount: 'unlimited' });
  });

  it('decodes mintTo (7) and burn (8)', () => {
    const mint = decodeTokenInstruction(
      tokenIx(7, u64le(1000n), [pk(9), pk(2), pk(3)]),
      'SPL Token',
      'spl-token',
    );
    expect(mint.type).toBe('mintTo');
    expect(mint.effects?.[0]).toMatchObject({ kind: 'mint', amount: 1000n });

    const burn = decodeTokenInstruction(
      tokenIx(8, u64le(50n), [pk(2), pk(9), pk(3)]),
      'SPL Token',
      'spl-token',
    );
    expect(burn.type).toBe('burn');
    expect(burn.effects?.[0]).toMatchObject({ kind: 'burn', amount: 50n });
  });

  it('decodes closeAccount (9)', () => {
    const out = decodeTokenInstruction(
      tokenIx(9, [], [pk(1), pk(2), pk(3)]),
      'SPL Token',
      'spl-token',
    );
    expect(out.type).toBe('closeAccount');
    expect(out.effects?.[0]).toMatchObject({ kind: 'close-account' });
  });

  it('decodes syncNative (17)', () => {
    const out = decodeTokenInstruction(tokenIx(17, [], [pk(1)]), 'SPL Token', 'spl-token');
    expect(out.type).toBe('syncNative');
    expect(out.effects?.[0]).toMatchObject({ kind: 'sync-native' });
  });

  it('unknown tag → not decoded, no throw', () => {
    const out = decodeTokenInstruction(tokenIx(99, [], [pk(1)]), 'SPL Token', 'spl-token');
    expect(out.decoded).toBe(false);
  });
});
