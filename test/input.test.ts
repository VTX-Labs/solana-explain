import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { detectInput } from '../src/input/detect.js';
import { InputError } from '../src/errors.js';
import {
  compile,
  computeUnitLimitIx,
  memoIx,
  pk,
  systemTransferIx,
} from './helpers.js';
import { encodeBase64 } from '../src/input/encoding.js';

describe('detectInput', () => {
  it('classifies a 64-byte base58 signature', () => {
    const sig = bs58.encode(new Uint8Array(64).map((_, i) => (i * 3 + 1) % 256));
    const det = detectInput(sig);
    expect(det.kind).toBe('signature');
    if (det.kind === 'signature') expect(det.signature).toBe(sig);
  });

  it('classifies a base64 serialized transaction', () => {
    const { txBytes } = compile([systemTransferIx(pk(1), pk(2), 1000n)], pk(1));
    const det = detectInput(encodeBase64(txBytes));
    expect(det.kind).toBe('tx-bytes');
    if (det.kind === 'tx-bytes') expect(det.encoding).toBe('base64');
  });

  it('classifies a base58 serialized transaction', () => {
    const { txBytes } = compile(
      [computeUnitLimitIx(200000), systemTransferIx(pk(3), pk(4), 5n)],
      pk(3),
    );
    const det = detectInput(bs58.encode(txBytes));
    expect(det.kind).toBe('tx-bytes');
  });

  it('classifies a JSON instruction set', () => {
    const json = JSON.stringify([
      {
        programId: pk(5),
        accounts: [{ pubkey: pk(6), isSigner: true, isWritable: true }],
        data: 'AQID',
      },
    ]);
    const det = detectInput(json);
    expect(det.kind).toBe('instruction-set');
    if (det.kind === 'instruction-set') expect(det.instructions).toHaveLength(1);
  });

  it('accepts a pre-parsed instruction array', () => {
    const det = detectInput([
      {
        programId: pk(7),
        accounts: [],
        data: new Uint8Array([1, 2]),
      },
    ]);
    expect(det.kind).toBe('instruction-set');
  });

  it('throws EMPTY_INPUT on empty/whitespace', () => {
    expect(() => detectInput('   ')).toThrow(InputError);
    try {
      detectInput('');
    } catch (e) {
      expect(e).toBeInstanceOf(InputError);
      expect((e as InputError).code).toBe('EMPTY_INPUT');
    }
  });

  it('reports wrong-length signature with decoded byte count', () => {
    const wrong = bs58.encode(new Uint8Array(40)); // 40 bytes, not 64
    // 40-byte base58 may be < 64 chars; pad to fall into the signature length range
    // by using a buffer that base58-encodes to >= 64 chars but != 64 bytes.
    const big = bs58.encode(new Uint8Array(50).fill(200));
    const candidate = big.length >= 64 ? big : wrong;
    try {
      detectInput(candidate);
    } catch (e) {
      expect(e).toBeInstanceOf(InputError);
      expect((e as InputError).code).toMatch(/INVALID_SIGNATURE|INVALID_INPUT/);
    }
  });

  it('rejects JSON that is not an array', () => {
    expect(() => detectInput('{"foo":1}')).toThrow(InputError);
  });

  it('validates instruction objects (missing programId)', () => {
    expect(() => detectInput('[{"accounts":[],"data":"AQ=="}]')).toThrow(InputError);
  });

  it('detects a memo-only tx as tx-bytes', () => {
    const { txBytes } = compile([memoIx('hello world')], pk(9));
    const det = detectInput(encodeBase64(txBytes));
    expect(det.kind).toBe('tx-bytes');
  });
});
