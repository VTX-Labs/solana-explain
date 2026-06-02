/**
 * Simulate acquisition path (unsigned/raw/instructions).
 *
 * The central asymmetry: `simulateTransaction` returns post-state for requested
 * accounts but NOT pre-state, and never preTokenBalances. So we:
 *   1. Decode the wire message → collect writable account keys.
 *   2. `getMultipleAccounts(writable)` for the PRE snapshot.
 *   3. `simulateTransaction(base64, { accounts: { addresses: writable } })` for
 *      the POST snapshot + logs + unitsConsumed + err + innerInstructions.
 *   4. Synthesize pre/post token balances from jsonParsed SPL/Token-2022 states
 *      on both sides, then diff identically to the signature path.
 */

import { SimulationError } from '../errors.js';
import type { Commitment, Warning } from '../types.js';
import type { RawAccount, RpcClient } from '../rpc/types.js';
import {
  buildAccountList,
  parseMessage,
  stripSignatures,
  toInstructionViews,
} from '../decode/message.js';
import { decodeBase58, encodeBase64 } from '../input/encoding.js';
import {
  innerFromMeta,
  tokenBalanceFromAccount,
  type NormalizedTx,
} from './normalize.js';
import { humanizeTxError } from './tx-error.js';

export interface FromSimulationArgs {
  rpc: RpcClient;
  txBytes: Uint8Array;
  commitment: Commitment;
  replaceRecentBlockhash: boolean;
  sigVerify: boolean;
  signal?: AbortSignal;
  includeRaw?: boolean;
  /** Note to attach when signatures were not verified. */
  unsignedNote?: boolean;
}

function accountLamports(acc: RawAccount | null): bigint {
  return acc ? BigInt(acc.lamports) : 0n;
}

export async function acquireFromSimulation(args: FromSimulationArgs): Promise<NormalizedTx> {
  const { rpc, txBytes, commitment, replaceRecentBlockhash, sigVerify, signal, includeRaw } = args;

  const stripped = stripSignatures(txBytes);
  const parsed = parseMessage(stripped);
  const resolved = buildAccountList(parsed); // no loaded addresses pre-sim
  const accountKeys = resolved.accountKeys;
  const instructions = toInstructionViews(parsed, resolved);
  const feePayer = accountKeys[0] ?? '';

  const warnings: Warning[] = [];
  if (parsed.version === 0 && parsed.hasUnresolvedLut) {
    warnings.push({
      code: 'lut-unresolved',
      message:
        'versioned tx references address lookup tables; simulate path diffs only resolved writable keys',
    });
  }
  // Note: with sigVerify:false (the default for unsigned simulation) signatures
  // are intentionally not checked. That is expected behavior, not a failure, so
  // we do not emit a warning for it here.

  // Writable account keys = pre/post snapshot targets.
  const writable = accountKeys.filter((_, i) => resolved.isWritable[i]);
  const uniqueWritable = [...new Set(writable)];

  // ---- PRE snapshot ----
  const preAccounts = await rpc.getMultipleAccounts(uniqueWritable, {
    commitment,
    encoding: 'jsonParsed',
    ...(signal ? { signal } : {}),
  });

  const txBase64 = encodeBase64(txBytes);

  // ---- Simulate for POST snapshot ----
  const sim = await rpc.simulateTransaction(txBase64, {
    commitment,
    sigVerify,
    replaceRecentBlockhash,
    innerInstructions: true,
    accounts: { addresses: uniqueWritable, encoding: 'jsonParsed' },
    ...(signal ? { signal } : {}),
  });

  const value = sim.value;
  const postAccounts = value.accounts ?? [];

  // Build address→pre/post lamports + token balances.
  const preLamportsByAddr = new Map<string, bigint>();
  const postLamportsByAddr = new Map<string, bigint>();
  const preTokens: NormalizedTx['pre']['tokenBalances'] = [];
  const postTokens: NormalizedTx['post']['tokenBalances'] = [];

  uniqueWritable.forEach((addr, i) => {
    const preAcc = preAccounts[i] ?? null;
    const postAcc = postAccounts[i] ?? null;
    preLamportsByAddr.set(addr, accountLamports(preAcc));
    // If the node didn't return a post account for an index, fall back to pre
    // (unchanged) so we don't fabricate a drain.
    postLamportsByAddr.set(addr, postAcc ? accountLamports(postAcc) : accountLamports(preAcc));

    const preTb = tokenBalanceFromAccount(addr, preAcc);
    if (preTb) preTokens.push(preTb);
    const postTb = tokenBalanceFromAccount(addr, postAcc);
    if (postTb) postTokens.push(postTb);
  });

  // Lamport arrays aligned to accountKeys order.
  const preLamports = accountKeys.map((k) => preLamportsByAddr.get(k) ?? 0n);
  const postLamports = accountKeys.map((k) => postLamportsByAddr.get(k) ?? preLamportsByAddr.get(k) ?? 0n);

  const inner = value.innerInstructions
    ? innerFromMeta(
        value.innerInstructions,
        accountKeys,
        decodeBase58,
        resolved.isSigner,
        resolved.isWritable,
      )
    : [];

  const err = value.err ?? null;
  const success = err === null || err === undefined;
  const error = success ? undefined : humanizeTxError(err, instructions);
  if (!success) {
    warnings.push({
      code: 'simulation-failed',
      message: 'simulation returned a runtime error; balance diff reflects the pre-state',
    });
  }

  const result: NormalizedTx = {
    source: 'simulation',
    feePayer,
    success,
    ...(error ? { error } : {}),
    slot: sim.context.slot,
    blockTime: null,
    // Simulation does not surface a fee; fee impact is visible via lamport diff.
    feeLamports: 0n,
    ...(value.unitsConsumed !== undefined ? { computeUnits: value.unitsConsumed } : {}),
    pre: { accountKeys, lamports: preLamports, tokenBalances: preTokens },
    post: { accountKeys, lamports: postLamports, tokenBalances: postTokens },
    instructions,
    innerInstructions: inner,
    warnings,
    ...(includeRaw ? { raw: sim } : {}),
  };
  return result;
}

/**
 * Detect a node *rejecting* a simulation outright (bad blockhash, missing
 * account, programs that can't simulate). The RPC layer maps some of these to
 * RpcError already; this helper converts a soft "value.err that is a structural
 * rejection" into a SimulationError when appropriate.
 */
export function rejectionToError(value: {
  err: unknown;
  logs: string[] | null;
}): SimulationError | null {
  const err = value.err;
  if (err === null || err === undefined) return null;
  // BlockhashNotFound / SanitizeFailure are structural rejections.
  const text = typeof err === 'string' ? err : JSON.stringify(err);
  if (/BlockhashNotFound|SanitizeFailure|AccountNotFound|ProgramAccountNotFound/i.test(text)) {
    const logs = value.logs ?? [];
    return new SimulationError(
      'SIMULATION_REJECTED',
      `Node rejected the simulation: ${humanizeTxError(err).human}`,
      { logs: logs.slice(-5) },
    );
  }
  return null;
}
