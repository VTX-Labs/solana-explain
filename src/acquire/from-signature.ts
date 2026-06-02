/**
 * Signature acquisition path: `getTransaction` → diff pre/post balances.
 *
 * We request base64 *message* encoding so we can resolve per-account roles
 * ourselves (jsonParsed doesn't expose signer/writable flags cleanly across
 * versions), but we still consume meta's pre/post (token) balances, fee,
 * innerInstructions, loadedAddresses, and err — the rich authoritative data.
 */

import { RpcError } from '../errors.js';
import type { Commitment, Warning } from '../types.js';
import type { RpcClient, RawTransactionResponse } from '../rpc/types.js';
import { buildAccountList, parseMessage, toInstructionViews } from '../decode/message.js';
import { decodeBase58, decodeBase64 } from '../input/encoding.js';
import {
  innerFromMeta,
  tokenBalancesFromMeta,
  type NormalizedTx,
} from './normalize.js';
import { humanizeTxError } from './tx-error.js';

export interface FromSignatureArgs {
  rpc: RpcClient;
  signature: string;
  commitment: Commitment;
  maxSupportedTransactionVersion: number;
  signal?: AbortSignal;
  includeRaw?: boolean;
}

export async function acquireFromSignature(args: FromSignatureArgs): Promise<NormalizedTx> {
  const { rpc, signature, commitment, maxSupportedTransactionVersion, signal, includeRaw } = args;

  const resp = await rpc.getTransaction(signature, {
    commitment,
    maxSupportedTransactionVersion,
    ...(signal ? { signal } : {}),
  });

  if (resp === null) {
    throw new RpcError(
      'TX_NOT_FOUND',
      `Transaction ${signature} not found at commitment "${commitment}".`,
      {
        hint: 'Try --commitment finalized, verify the signature, or check you are on the right cluster.',
      },
    );
  }

  return normalizeSignatureResponse(resp, signature, includeRaw ?? false);
}

export function normalizeSignatureResponse(
  resp: RawTransactionResponse,
  signature: string,
  includeRaw: boolean,
): NormalizedTx {
  const warnings: Warning[] = [];
  const meta = resp.meta;

  // The base64 `message` field from getTransaction is the MESSAGE itself
  // (no leading signatures), so we parse it directly.
  const messageBytes = decodeMessageBytes(resp.transaction.message);
  const parsed = parseMessage(messageBytes);

  const loaded = meta?.loadedAddresses
    ? { writable: meta.loadedAddresses.writable, readonly: meta.loadedAddresses.readonly }
    : undefined;

  if (parsed.version === 0 && parsed.hasUnresolvedLut && !loaded) {
    warnings.push({
      code: 'lut-unresolved',
      message: 'versioned tx uses address lookup tables not resolved by the node response',
    });
  }

  const resolved = buildAccountList(parsed, loaded);
  const accountKeys = resolved.accountKeys;
  const instructions = toInstructionViews(parsed, resolved);

  const feePayer = accountKeys[0] ?? '';

  const preLamports = (meta?.preBalances ?? []).map((n) => BigInt(n));
  const postLamports = (meta?.postBalances ?? []).map((n) => BigInt(n));

  const preTokens = tokenBalancesFromMeta(meta?.preTokenBalances, accountKeys);
  const postTokens = tokenBalancesFromMeta(meta?.postTokenBalances, accountKeys);

  const inner = meta?.innerInstructions
    ? innerFromMeta(
        meta.innerInstructions,
        accountKeys,
        decodeBase58,
        resolved.isSigner,
        resolved.isWritable,
      )
    : [];
  if (!meta?.innerInstructions) {
    warnings.push({
      code: 'inner-instructions-missing',
      message: 'node did not return inner instructions (CPI tree unavailable)',
    });
  }

  const err = meta?.err ?? null;
  const success = err === null || err === undefined;
  const error = success ? undefined : humanizeTxError(err, instructions);

  const result: NormalizedTx = {
    source: 'signature',
    signature,
    feePayer,
    success,
    ...(error ? { error } : {}),
    slot: resp.slot,
    blockTime: resp.blockTime,
    feeLamports: BigInt(meta?.fee ?? 0),
    ...(meta?.computeUnitsConsumed !== undefined
      ? { computeUnits: meta.computeUnitsConsumed }
      : {}),
    pre: { accountKeys, lamports: preLamports, tokenBalances: preTokens },
    post: { accountKeys, lamports: postLamports, tokenBalances: postTokens },
    instructions,
    innerInstructions: inner,
    warnings,
    ...(includeRaw ? { raw: resp } : {}),
  };
  return result;
}

function decodeMessageBytes(message: unknown): Uint8Array {
  // base64 message encoding → ["<base64>", "base64"]
  if (Array.isArray(message) && typeof message[0] === 'string') {
    const enc = message[1];
    if (enc === 'base64') return decodeBase64(message[0]);
    if (enc === 'base58') return decodeBase58(message[0]);
    return decodeBase64(message[0]);
  }
  if (typeof message === 'string') {
    return decodeBase64(message);
  }
  // Some nodes return a structured message even when base64 requested; we can't
  // resolve roles from that here, so surface a decode error.
  throw new RpcError(
    'RPC_JSON',
    'Unexpected transaction.message shape; expected base64-encoded message.',
  );
}
