/**
 * Legacy + v0 wire-message parser.
 *
 * Parses the Solana transaction wire format (compact-u16 arrays, account-key
 * table, header signer/writable counts, address-table-lookups) into
 * {@link CompiledInstructionView}[] with resolved per-account roles.
 *
 * The wire layout we parse here is the *message*. A full serialized
 * transaction prefixes the message with a compact-u16 array of 64-byte
 * signatures; we detect and skip that automatically.
 */

import { DecodeError } from '../errors.js';
import type { CompiledInstructionView } from '../types.js';
import { encodeBase58 } from '../input/encoding.js';
import { Reader } from './reader.js';

const VERSION_PREFIX_MASK = 0x80;

export interface ParsedMessage {
  version: 'legacy' | number;
  /** Account keys present *in the message* (not yet LUT-resolved). */
  staticAccountKeys: string[];
  header: {
    numRequiredSignatures: number;
    numReadonlySignedAccounts: number;
    numReadonlyUnsignedAccounts: number;
  };
  recentBlockhash: string;
  /** Raw compiled instructions referencing account indexes into the full key list. */
  compiled: { programIdIndex: number; accountIndexes: number[]; data: Uint8Array }[];
  /** Present for v0; index references into LUT accounts. */
  addressTableLookups: { accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }[];
  /** True if a v0 message references address tables we have not resolved. */
  hasUnresolvedLut: boolean;
}

/**
 * Detect whether a buffer is a full serialized transaction (with signatures)
 * and, if so, return the message slice. Heuristic: read a compact-u16 sig
 * count `n`, and check there are exactly `n*64` signature bytes followed by a
 * plausible message header. Falls back to treating the whole buffer as a
 * message.
 */
export function stripSignatures(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) {
    throw new DecodeError('DECODE_FAILED', 'empty transaction buffer');
  }
  // A bare message starts with either a version byte (>= 0x80) or a header
  // whose first byte (numRequiredSignatures) is small (< ~20). A full tx
  // starts with a compact-u16 signature count.
  const reader = new Reader(bytes);
  let sigCount: number;
  try {
    sigCount = reader.compactU16('signature count');
  } catch {
    return bytes;
  }
  // Plausibility: signatures present and the byte right after them looks like a
  // version prefix or a small header.
  if (sigCount > 0 && sigCount <= 64) {
    const afterSigs = reader.offset + sigCount * 64;
    if (afterSigs < bytes.length) {
      const next = bytes[afterSigs];
      if (next !== undefined) {
        const looksVersioned = (next & VERSION_PREFIX_MASK) !== 0;
        const looksLegacyHeader = next > 0 && next <= 32;
        if (looksVersioned || looksLegacyHeader) {
          return bytes.subarray(afterSigs);
        }
      }
    }
  }
  // No leading signatures detected → it's already a message.
  return bytes;
}

/** Parse a wire message (legacy or v0). */
export function parseMessage(messageBytes: Uint8Array): ParsedMessage {
  const r = new Reader(messageBytes);
  const firstByte = r.u8('version/header byte');

  let version: 'legacy' | number;
  let numRequiredSignatures: number;
  if ((firstByte & VERSION_PREFIX_MASK) !== 0) {
    version = firstByte & 0x7f;
    if (version !== 0) {
      throw new DecodeError(
        'DECODE_FAILED',
        `unsupported transaction message version v${version} (only legacy and v0 are supported)`,
      );
    }
    numRequiredSignatures = r.u8('numRequiredSignatures');
  } else {
    version = 'legacy';
    numRequiredSignatures = firstByte;
  }

  const numReadonlySignedAccounts = r.u8('numReadonlySignedAccounts');
  const numReadonlyUnsignedAccounts = r.u8('numReadonlyUnsignedAccounts');

  const keyCount = r.compactU16('account key count');
  if (keyCount > 256) {
    throw new DecodeError('DECODE_FAILED', `implausible account key count: ${keyCount}`);
  }
  const staticAccountKeys: string[] = [];
  for (let i = 0; i < keyCount; i++) {
    staticAccountKeys.push(r.pubkey(`account key #${i}`));
  }

  const recentBlockhash = r.pubkey('recentBlockhash');

  const ixCount = r.compactU16('instruction count');
  if (ixCount > 1024) {
    throw new DecodeError('DECODE_FAILED', `implausible instruction count: ${ixCount}`);
  }
  const compiled: ParsedMessage['compiled'] = [];
  for (let i = 0; i < ixCount; i++) {
    const programIdIndex = r.u8(`instruction #${i} programIdIndex`);
    const accCount = r.compactU16(`instruction #${i} account count`);
    const accountIndexes: number[] = [];
    for (let j = 0; j < accCount; j++) {
      accountIndexes.push(r.u8(`instruction #${i} account index #${j}`));
    }
    const dataLen = r.compactU16(`instruction #${i} data length`);
    const data = r.bytes_(dataLen, `instruction #${i} data`).slice();
    compiled.push({ programIdIndex, accountIndexes, data });
  }

  const addressTableLookups: ParsedMessage['addressTableLookups'] = [];
  let hasUnresolvedLut = false;
  if (version === 0) {
    const lutCount = r.compactU16('address table lookup count');
    for (let i = 0; i < lutCount; i++) {
      const accountKey = r.pubkey(`LUT #${i} account key`);
      const writableCount = r.compactU16(`LUT #${i} writable count`);
      const writableIndexes: number[] = [];
      for (let j = 0; j < writableCount; j++) {
        writableIndexes.push(r.u8(`LUT #${i} writable index #${j}`));
      }
      const readonlyCount = r.compactU16(`LUT #${i} readonly count`);
      const readonlyIndexes: number[] = [];
      for (let j = 0; j < readonlyCount; j++) {
        readonlyIndexes.push(r.u8(`LUT #${i} readonly index #${j}`));
      }
      addressTableLookups.push({ accountKey, writableIndexes, readonlyIndexes });
      if (writableIndexes.length + readonlyIndexes.length > 0) hasUnresolvedLut = true;
    }
  }

  return {
    version,
    staticAccountKeys,
    header: {
      numRequiredSignatures,
      numReadonlySignedAccounts,
      numReadonlyUnsignedAccounts,
    },
    recentBlockhash,
    compiled,
    addressTableLookups,
    hasUnresolvedLut,
  };
}

/**
 * Resolve compiled instructions into {@link CompiledInstructionView}[] with
 * full account roles.
 *
 * `loadedWritable`/`loadedReadonly` are the LUT-resolved addresses appended
 * after the static keys, in canonical order: `[...static, ...loadedWritable,
 * ...loadedReadonly]`. They are writable/readonly respectively.
 */
export function buildAccountList(
  msg: ParsedMessage,
  loaded?: { writable: string[]; readonly: string[] },
): {
  accountKeys: string[];
  isSigner: boolean[];
  isWritable: boolean[];
} {
  const loadedWritable = loaded?.writable ?? [];
  const loadedReadonly = loaded?.readonly ?? [];
  const accountKeys = [...msg.staticAccountKeys, ...loadedWritable, ...loadedReadonly];

  const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } =
    msg.header;
  const staticCount = msg.staticAccountKeys.length;

  const isSigner: boolean[] = [];
  const isWritable: boolean[] = [];

  for (let i = 0; i < accountKeys.length; i++) {
    if (i < staticCount) {
      const signer = i < numRequiredSignatures;
      // Within signed block: writable unless in the readonly-signed tail.
      // Within unsigned static block: writable unless in the readonly-unsigned tail.
      let writable: boolean;
      if (signer) {
        writable = i < numRequiredSignatures - numReadonlySignedAccounts;
      } else {
        const unsignedIndex = i - numRequiredSignatures;
        const unsignedWritableCount =
          staticCount - numRequiredSignatures - numReadonlyUnsignedAccounts;
        writable = unsignedIndex < unsignedWritableCount;
      }
      isSigner.push(signer);
      isWritable.push(writable);
    } else {
      // Loaded addresses: never signers. Writable for the writable block.
      const loadedIndex = i - staticCount;
      isSigner.push(false);
      isWritable.push(loadedIndex < loadedWritable.length);
    }
  }

  return { accountKeys, isSigner, isWritable };
}

/** Turn parsed + resolved message into instruction views. */
export function toInstructionViews(
  msg: ParsedMessage,
  resolved: { accountKeys: string[]; isSigner: boolean[]; isWritable: boolean[] },
): CompiledInstructionView[] {
  const { accountKeys, isSigner, isWritable } = resolved;
  return msg.compiled.map((ix, index) => {
    const programId = accountKeys[ix.programIdIndex];
    if (programId === undefined) {
      throw new DecodeError(
        'DECODE_FAILED',
        `instruction #${index} programIdIndex ${ix.programIdIndex} out of range (have ${accountKeys.length} keys)`,
      );
    }
    const accounts = ix.accountIndexes.map((ai) => {
      const pubkey = accountKeys[ai];
      if (pubkey === undefined) {
        throw new DecodeError(
          'DECODE_FAILED',
          `instruction #${index} references account index ${ai} out of range (have ${accountKeys.length} keys)`,
        );
      }
      return {
        pubkey,
        isSigner: isSigner[ai] ?? false,
        isWritable: isWritable[ai] ?? false,
      };
    });
    return { index, programId, accounts, data: ix.data };
  });
}

/**
 * Convenience: decode a full serialized transaction (with or without
 * signatures) into instruction views + parsed message. LUT-resolved addresses
 * may be supplied (e.g. from `meta.loadedAddresses`).
 */
export function decodeWireTransaction(
  bytes: Uint8Array,
  loaded?: { writable: string[]; readonly: string[] },
): { message: ParsedMessage; instructions: CompiledInstructionView[]; accountKeys: string[] } {
  const messageBytes = stripSignatures(bytes);
  const message = parseMessage(messageBytes);
  const resolved = buildAccountList(message, loaded);
  const instructions = toInstructionViews(message, resolved);
  return { message, instructions, accountKeys: resolved.accountKeys };
}

/** Validate a 64-byte signature buffer → base58 string. */
export function signatureFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 64) {
    throw new DecodeError('DECODE_FAILED', `signature must be 64 bytes, got ${bytes.length}`);
  }
  return encodeBase58(bytes);
}
