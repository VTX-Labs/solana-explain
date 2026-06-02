import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import {
  decodeBase58,
  decodeBase64,
  encodeBase58,
  encodeBase64,
  normalizeRpcUrl,
  tryDecodeBase58,
  tryDecodeBase64,
} from '../src/input/encoding.js';
import { InputError } from '../src/errors.js';

describe('encoding', () => {
  it('round-trips base58 for 32- and 64-byte buffers', () => {
    const b32 = new Uint8Array(32).map((_, i) => (i * 7) % 256);
    const b64 = new Uint8Array(64).map((_, i) => (i * 13) % 256);
    expect(decodeBase58(encodeBase58(b32))).toEqual(b32);
    expect(decodeBase58(encodeBase58(b64))).toEqual(b64);
  });

  it('decodes a known base64 buffer', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const b64 = encodeBase64(bytes);
    expect(decodeBase64(b64)).toEqual(bytes);
  });

  it('throws InputError on invalid base58', () => {
    expect(() => decodeBase58('0OIl')).toThrow(InputError);
  });

  it('tryDecode returns null on invalid input', () => {
    expect(tryDecodeBase58('!!!not base58!!!')).toBeNull();
    expect(tryDecodeBase64('not base64 @@@')).toBeNull();
  });

  it('tryDecodeBase64 rejects loose matches that do not round-trip', () => {
    // 'abc' is not a multiple of 4 → null.
    expect(tryDecodeBase64('abc')).toBeNull();
  });

  it('normalizes scheme-less and whitespace-padded RPC URLs', () => {
    expect(normalizeRpcUrl('  api.devnet.solana.com  ')).toBe('https://api.devnet.solana.com/');
    expect(normalizeRpcUrl('https://x.example.com')).toBe('https://x.example.com/');
    expect(normalizeRpcUrl('http://127.0.0.1:8899')).toBe('http://127.0.0.1:8899/');
  });

  it('rejects clearly invalid RPC URLs', () => {
    expect(() => normalizeRpcUrl('ftp://nope')).toThrow(InputError);
    expect(() => normalizeRpcUrl('')).toThrow(InputError);
  });

  it('matches bs58 baseline', () => {
    const bytes = new Uint8Array([255, 0, 128, 64]);
    expect(encodeBase58(bytes)).toBe(bs58.encode(bytes));
  });
});
