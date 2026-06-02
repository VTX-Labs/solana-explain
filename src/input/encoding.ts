/**
 * Base58/base64 decode helpers + RPC URL scheme normalization.
 *
 * bs58 is our single hard runtime dependency — the de-facto Solana standard.
 */

import bs58 from 'bs58';
import { InputError } from '../errors.js';

/** Decode base58 into bytes. Throws {@link InputError} on invalid alphabet. */
export function decodeBase58(input: string): Uint8Array {
  try {
    return bs58.decode(input);
  } catch (err) {
    throw new InputError('INVALID_ENCODING', 'Input is not valid base58.', { cause: err });
  }
}

/** Encode bytes to base58. */
export function encodeBase58(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

/** Try base58; return `null` instead of throwing. */
export function tryDecodeBase58(input: string): Uint8Array | null {
  try {
    const out = bs58.decode(input);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decode base64 into bytes. Throws {@link InputError} on invalid input. */
export function decodeBase64(input: string): Uint8Array {
  const trimmed = input.trim();
  if (!BASE64_RE.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new InputError('INVALID_ENCODING', 'Input is not valid base64.');
  }
  try {
    return new Uint8Array(Buffer.from(trimmed, 'base64'));
  } catch (err) {
    throw new InputError('INVALID_ENCODING', 'Input is not valid base64.', { cause: err });
  }
}

/** Try base64; return `null` instead of throwing. Validates round-trip to reject loose matches. */
export function tryDecodeBase64(input: string): Uint8Array | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length % 4 !== 0 || !BASE64_RE.test(trimmed)) return null;
  try {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 0) return null;
    // Re-encode and compare to reject inputs Buffer silently truncates.
    if (buf.toString('base64') !== trimmed) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Encode bytes as base64. */
export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Looks like base64 (contains `+`, `/`, or `=`, or only base64 alphabet)? */
export function looksLikeBase64(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  if (/[+/=]/.test(trimmed)) return true;
  return BASE64_RE.test(trimmed);
}

/** Looks like base58 (only base58 alphabet, no `0OIl`)? */
export function looksLikeBase58(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
}

/**
 * Normalize an RPC URL: trim whitespace, prepend `https://` if scheme-less.
 * Throws {@link InputError} if clearly invalid.
 */
export function normalizeRpcUrl(url: string): string {
  let u = url.trim();
  if (u.length === 0) {
    throw new InputError('INVALID_INPUT', 'RPC URL is empty.');
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) {
    // Scheme-less — assume https.
    u = `https://${u}`;
  }
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new InputError(
        'INVALID_INPUT',
        `Unsupported RPC URL scheme "${parsed.protocol}". Use http(s).`,
      );
    }
    return parsed.toString();
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError('INVALID_INPUT', `Invalid RPC URL: ${url}`, { cause: err });
  }
}
