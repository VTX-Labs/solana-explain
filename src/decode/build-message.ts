/**
 * Assemble a legacy wire message (with empty signature placeholders) from a set
 * of {@link ExplainInstruction}s + a fee payer, so it can be simulated.
 *
 * We build a *legacy* message (sufficient for simulation), compute the canonical
 * account ordering (signers-writable, signers-readonly, nonsigners-writable,
 * nonsigners-readonly), and emit the compact-u16 wire format.
 */

import { InputError } from '../errors.js';
import type { ExplainInstruction } from '../types.js';
import { decodeBase58, decodeBase64, looksLikeBase64 } from '../input/encoding.js';
import bs58 from 'bs58';

interface AccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

function normalizeData(data: ExplainInstruction['data']): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data);
  // string: prefer base58 (Solana instruction data convention) unless it looks
  // like base64.
  if (looksLikeBase64(data) && /[+/=]/.test(data)) {
    return decodeBase64(data);
  }
  try {
    return decodeBase58(data);
  } catch {
    return decodeBase64(data);
  }
}

function writeCompactU16(out: number[], value: number): void {
  let v = value;
  for (;;) {
    let byte = v & 0x7f;
    v >>= 7;
    if (v === 0) {
      out.push(byte);
      return;
    }
    byte |= 0x80;
    out.push(byte);
  }
}

/** Assemble a legacy message buffer from instructions + fee payer. */
export function buildLegacyMessage(
  instructions: ExplainInstruction[],
  feePayer: string,
  recentBlockhash: string,
): Uint8Array {
  if (instructions.length === 0) {
    throw new InputError('EMPTY_INPUT', 'No instructions to assemble.');
  }

  // Collect all account metas, with the fee payer forced first + signer+writable.
  const metaByKey = new Map<string, AccountMeta>();
  const upsert = (m: AccountMeta) => {
    const cur = metaByKey.get(m.pubkey);
    if (cur) {
      cur.isSigner = cur.isSigner || m.isSigner;
      cur.isWritable = cur.isWritable || m.isWritable;
    } else {
      metaByKey.set(m.pubkey, { ...m });
    }
  };

  upsert({ pubkey: feePayer, isSigner: true, isWritable: true });
  for (const ix of instructions) {
    for (const a of ix.accounts) upsert({ ...a });
    // Program ids are readonly non-signers.
    upsert({ pubkey: ix.programId, isSigner: false, isWritable: false });
  }

  const all = [...metaByKey.values()];
  // Ensure fee payer is first.
  all.sort((a, b) => {
    if (a.pubkey === feePayer) return -1;
    if (b.pubkey === feePayer) return 1;
    // Order: signer+writable, signer+ro, nonsigner+writable, nonsigner+ro
    const rank = (m: AccountMeta) =>
      m.isSigner ? (m.isWritable ? 0 : 1) : m.isWritable ? 2 : 3;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.pubkey.localeCompare(b.pubkey);
  });

  const numRequiredSignatures = all.filter((m) => m.isSigner).length;
  const numReadonlySignedAccounts = all.filter((m) => m.isSigner && !m.isWritable).length;
  const numReadonlyUnsignedAccounts = all.filter((m) => !m.isSigner && !m.isWritable).length;

  const keyIndex = new Map<string, number>();
  all.forEach((m, i) => keyIndex.set(m.pubkey, i));

  const out: number[] = [];
  out.push(numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts);

  // Account keys.
  writeCompactU16(out, all.length);
  for (const m of all) {
    const bytes = decodePubkey(m.pubkey);
    out.push(...bytes);
  }

  // Recent blockhash (32 bytes).
  out.push(...decodePubkey(recentBlockhash));

  // Instructions.
  writeCompactU16(out, instructions.length);
  for (const ix of instructions) {
    const programIdIndex = keyIndex.get(ix.programId);
    if (programIdIndex === undefined) {
      throw new InputError('INVALID_INPUT', `programId ${ix.programId} not in account list`);
    }
    out.push(programIdIndex);
    writeCompactU16(out, ix.accounts.length);
    for (const a of ix.accounts) {
      const idx = keyIndex.get(a.pubkey);
      if (idx === undefined) {
        throw new InputError('INVALID_INPUT', `account ${a.pubkey} not in account list`);
      }
      out.push(idx);
    }
    const data = normalizeData(ix.data);
    writeCompactU16(out, data.length);
    out.push(...data);
  }

  // Prepend empty signatures so the buffer is a full (unsigned) transaction.
  const message = Uint8Array.from(out);
  const tx: number[] = [];
  writeCompactU16(tx, numRequiredSignatures);
  for (let i = 0; i < numRequiredSignatures; i++) {
    for (let j = 0; j < 64; j++) tx.push(0);
  }
  tx.push(...message);
  return Uint8Array.from(tx);
}

function decodePubkey(pubkey: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(pubkey);
  } catch (err) {
    throw new InputError('INVALID_INPUT', `Invalid base58 pubkey: ${pubkey}`, { cause: err });
  }
  if (bytes.length !== 32) {
    throw new InputError(
      'INVALID_INPUT',
      `Pubkey ${pubkey} decoded to ${bytes.length} bytes (expected 32).`,
    );
  }
  return bytes;
}
