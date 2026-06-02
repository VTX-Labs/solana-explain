/**
 * `detectInput`: classify a raw argument into
 *   `signature | tx-bytes | instruction-set`,
 * normalizing encodings. Throws {@link InputError} early with precise messages.
 */

import { InputError } from '../errors.js';
import type { ExplainInstruction } from '../types.js';
import {
  looksLikeBase58,
  tryDecodeBase58,
  tryDecodeBase64,
} from './encoding.js';
import { parseMessage, stripSignatures } from '../decode/message.js';

export type DetectedInput =
  | { kind: 'signature'; signature: string }
  | { kind: 'tx-bytes'; bytes: Uint8Array; encoding: 'base64' | 'base58'; ambiguous: boolean }
  | { kind: 'instruction-set'; instructions: ExplainInstruction[] };

/** Detect the kind of a string/bytes/instruction-array input. */
export function detectInput(
  input: string | Uint8Array | ExplainInstruction[],
): DetectedInput {
  // Pre-parsed instruction set.
  if (Array.isArray(input)) {
    return { kind: 'instruction-set', instructions: validateInstructions(input) };
  }

  // Raw bytes → must be a wire tx.
  if (input instanceof Uint8Array) {
    if (input.length === 0) {
      throw new InputError('EMPTY_INPUT', 'Empty byte input.', {
        hint: 'Pass a signature, a serialized transaction, or pipe data via --stdin.',
      });
    }
    assertWireMessage(input, 'raw bytes');
    return { kind: 'tx-bytes', bytes: input, encoding: 'base64', ambiguous: false };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new InputError('EMPTY_INPUT', 'Input is empty or whitespace only.', {
      hint: 'Pass a signature, a serialized transaction, or pipe data via --stdin.',
    });
  }

  // JSON instruction set (only via explicit string here; CLI also routes this).
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new InputError('INVALID_INPUT', 'Input looks like JSON but failed to parse.', {
        cause: err,
      });
    }
    const arr = Array.isArray(parsed) ? parsed : null;
    if (!arr) {
      throw new InputError(
        'INVALID_INPUT',
        'JSON instruction input must be an array of instructions.',
      );
    }
    return { kind: 'instruction-set', instructions: validateInstructions(arr) };
  }

  // Signature: base58 decoding to exactly 64 bytes, length 64–88 chars.
  if (looksLikeBase58(trimmed) && trimmed.length >= 64 && trimmed.length <= 88) {
    const decoded = tryDecodeBase58(trimmed);
    if (decoded && decoded.length === 64) {
      // But it could also be a base58-encoded tx of 64 bytes (rare). 64 bytes
      // is far too small to be a wire message, so treat as a signature.
      return { kind: 'signature', signature: trimmed };
    }
    if (decoded && decoded.length !== 64) {
      // Not a signature length; maybe a base58 tx. Fall through to tx detection.
    }
  }

  // Transaction bytes: try base64 then base58; prefer the one that parses as a
  // wire message. If both parse, prefer base64 + flag ambiguity.
  const asB64 = tryDecodeBase64(trimmed);
  const asB58 = tryDecodeBase58(trimmed);

  const b64Ok = asB64 ? isWireMessage(asB64) : false;
  const b58Ok = asB58 ? isWireMessage(asB58) : false;

  if (b64Ok && b58Ok) {
    return { kind: 'tx-bytes', bytes: asB64!, encoding: 'base64', ambiguous: true };
  }
  if (b64Ok) {
    return { kind: 'tx-bytes', bytes: asB64!, encoding: 'base64', ambiguous: false };
  }
  if (b58Ok) {
    return { kind: 'tx-bytes', bytes: asB58!, encoding: 'base58', ambiguous: false };
  }

  // Maybe it's a signature whose byte count is wrong → precise message.
  if (looksLikeBase58(trimmed)) {
    const decoded = tryDecodeBase58(trimmed);
    if (decoded) {
      throw new InputError(
        'INVALID_SIGNATURE',
        `Input decoded as ${decoded.length} bytes; a signature must be exactly 64 bytes, and it is not a valid transaction.`,
        { hint: 'Provide a 64-byte base58 signature or a base64/base58 serialized transaction.' },
      );
    }
  }

  throw new InputError(
    'INVALID_INPUT',
    'Could not classify input as a signature, transaction, or instruction set.',
    { hint: 'Provide a base58 signature, a base64/base58 transaction, or a JSON instruction array.' },
  );
}

/** Force a string to be interpreted as a serialized transaction (CLI --simulate). */
export function detectTxBytes(
  input: string,
  encoding: 'base64' | 'base58' | 'auto' = 'auto',
): { bytes: Uint8Array; encoding: 'base64' | 'base58'; ambiguous: boolean } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new InputError('EMPTY_INPUT', 'Empty transaction input.');
  }
  if (encoding === 'base64') {
    const bytes = tryDecodeBase64(trimmed);
    if (!bytes) throw new InputError('INVALID_ENCODING', 'Input is not valid base64.');
    assertWireMessage(bytes, 'base64 transaction');
    return { bytes, encoding: 'base64', ambiguous: false };
  }
  if (encoding === 'base58') {
    const bytes = tryDecodeBase58(trimmed);
    if (!bytes) throw new InputError('INVALID_ENCODING', 'Input is not valid base58.');
    assertWireMessage(bytes, 'base58 transaction');
    return { bytes, encoding: 'base58', ambiguous: false };
  }
  const asB64 = tryDecodeBase64(trimmed);
  const asB58 = tryDecodeBase58(trimmed);
  const b64Ok = asB64 ? isWireMessage(asB64) : false;
  const b58Ok = asB58 ? isWireMessage(asB58) : false;
  if (b64Ok) return { bytes: asB64!, encoding: 'base64', ambiguous: b58Ok };
  if (b58Ok) return { bytes: asB58!, encoding: 'base58', ambiguous: false };
  throw new InputError('DECODE_FAILED', 'Input did not parse as a serialized transaction.');
}

/** Does the byte buffer parse as a legacy/v0 wire message? */
function isWireMessage(bytes: Uint8Array): boolean {
  try {
    const stripped = stripSignatures(bytes);
    const msg = parseMessage(stripped);
    return msg.staticAccountKeys.length > 0 && msg.compiled.length >= 0;
  } catch {
    return false;
  }
}

function assertWireMessage(bytes: Uint8Array, label: string): void {
  if (!isWireMessage(bytes)) {
    throw new InputError(
      'DECODE_FAILED',
      `${label} did not parse as a Solana wire transaction message.`,
      { hint: 'Ensure the input is a serialized (not deserialized) transaction.' },
    );
  }
}

/** Validate + normalize a raw JSON instruction array. */
export function validateInstructions(arr: unknown[]): ExplainInstruction[] {
  if (arr.length === 0) {
    throw new InputError('EMPTY_INPUT', 'Instruction set is empty.');
  }
  return arr.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new InputError('INVALID_INPUT', `Instruction #${i} is not an object.`);
    }
    const o = raw as Record<string, unknown>;
    if (typeof o['programId'] !== 'string') {
      throw new InputError('INVALID_INPUT', `Instruction #${i} is missing a string "programId".`);
    }
    const accountsRaw = o['accounts'];
    if (!Array.isArray(accountsRaw)) {
      throw new InputError('INVALID_INPUT', `Instruction #${i} "accounts" must be an array.`);
    }
    const accounts = accountsRaw.map((a, j) => {
      if (typeof a !== 'object' || a === null) {
        throw new InputError('INVALID_INPUT', `Instruction #${i} account #${j} is not an object.`);
      }
      const ao = a as Record<string, unknown>;
      if (typeof ao['pubkey'] !== 'string') {
        throw new InputError(
          'INVALID_INPUT',
          `Instruction #${i} account #${j} is missing a string "pubkey".`,
        );
      }
      return {
        pubkey: ao['pubkey'],
        isSigner: Boolean(ao['isSigner']),
        isWritable: Boolean(ao['isWritable']),
      };
    });
    const data = o['data'];
    if (typeof data !== 'string' && !Array.isArray(data) && !(data instanceof Uint8Array)) {
      throw new InputError(
        'INVALID_INPUT',
        `Instruction #${i} "data" must be a base64/base58 string, byte array, or Uint8Array.`,
      );
    }
    return {
      programId: o['programId'],
      accounts,
      data: data as string | number[] | Uint8Array,
    };
  });
}
