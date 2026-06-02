import { describe, expect, it } from 'vitest';
import {
  decodeWireTransaction,
  parseMessage,
  stripSignatures,
} from '../src/decode/message.js';
import { DecodeError } from '../src/errors.js';
import {
  compile,
  computeUnitLimitIx,
  pk,
  systemTransferIx,
  SYSTEM,
} from './helpers.js';

describe('message decode', () => {
  it('parses a legacy message: header, keys, instructions, roles', () => {
    const from = pk(1);
    const to = pk(2);
    const { txBytes } = compile([systemTransferIx(from, to, 1234n)], from);
    const { message, instructions, accountKeys } = decodeWireTransaction(txBytes);

    expect(message.version).toBe('legacy');
    expect(accountKeys).toContain(from);
    expect(accountKeys).toContain(to);
    expect(accountKeys).toContain(SYSTEM);

    expect(instructions).toHaveLength(1);
    const ix = instructions[0]!;
    expect(ix.programId).toBe(SYSTEM);
    // from is signer + writable; to is writable non-signer.
    const fromAcc = ix.accounts.find((a) => a.pubkey === from)!;
    const toAcc = ix.accounts.find((a) => a.pubkey === to)!;
    expect(fromAcc.isSigner).toBe(true);
    expect(fromAcc.isWritable).toBe(true);
    expect(toAcc.isSigner).toBe(false);
    expect(toAcc.isWritable).toBe(true);
  });

  it('handles multiple instructions', () => {
    const payer = pk(3);
    const { txBytes } = compile(
      [computeUnitLimitIx(200000), systemTransferIx(payer, pk(4), 1n)],
      payer,
    );
    const { instructions } = decodeWireTransaction(txBytes);
    expect(instructions).toHaveLength(2);
  });

  it('strips leading signatures correctly', () => {
    const { txBytes } = compile([systemTransferIx(pk(5), pk(6), 7n)], pk(5));
    const stripped = stripSignatures(txBytes);
    // A bare message begins with the header (numRequiredSignatures = 1 here).
    expect(stripped[0]).toBe(1);
  });

  it('throws DECODE_FAILED naming the field on truncation', () => {
    const { txBytes } = compile([systemTransferIx(pk(7), pk(8), 9n)], pk(7));
    const stripped = stripSignatures(txBytes);
    const truncated = stripped.subarray(0, 5); // cut mid-message
    try {
      parseMessage(truncated);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DecodeError);
      expect((e as DecodeError).message).toMatch(/unexpected end while reading/);
    }
  });

  it('rejects implausible account key counts', () => {
    // Header (1,0,0) then compact-u16 of 0xffff.
    const bad = new Uint8Array([1, 0, 0, 0xff, 0xff, 0x03]);
    expect(() => parseMessage(bad)).toThrow(DecodeError);
  });
});
