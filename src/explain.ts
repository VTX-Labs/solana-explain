/**
 * Top-level orchestrators: `explain`, `explainSignature`, `explainTransaction`,
 * `explainInstructions`, and the pure `buildExplanation`.
 *
 * Behavioral contracts:
 *  - All public async functions reject ONLY with a SolanaExplainError subclass.
 *  - A failed/reverted tx still returns a fully-populated ExplainResult
 *    (success:false); it does NOT throw.
 *  - explainSignature on a missing sig throws RpcError TX_NOT_FOUND.
 *  - Simulation the node outright rejects throws SimulationError.
 */

import {
  InputError,
  SimulationError,
  SolanaExplainError,
  wrapError,
} from './errors.js';
import type {
  Commitment,
  ExplainInput,
  ExplainInstruction,
  ExplainInstructionsOptions,
  ExplainOptions,
  ExplainResult,
  ExplainSignatureOptions,
  ExplainTransactionOptions,
  ProgramRegistry,
  RpcClient,
} from './types.js';
import { createHttpRpc } from './rpc/http.js';
import { defaultRegistry } from './decode/registry.js';
import { detectInput, detectTxBytes } from './input/detect.js';
import { acquireFromSignature } from './acquire/from-signature.js';
import { acquireFromSimulation } from './acquire/from-simulation.js';
import type { NormalizedTx } from './acquire/normalize.js';
import { buildLegacyMessage } from './decode/build-message.js';
import { diffBalances } from './explain/diff.js';
import { correlate } from './explain/correlate.js';
import { summarize } from './explain/summarize.js';
import { resolveSymbol } from './explain/token-meta.js';

function resolveRpc(rpc: string | RpcClient, timeoutMs: number): RpcClient {
  if (typeof rpc === 'string') {
    return createHttpRpc(rpc, { timeoutMs });
  }
  return rpc;
}

function resolveRegistry(opts: ExplainOptions): ProgramRegistry {
  if (opts.registry) {
    return defaultRegistry.merge(opts.registry.list());
  }
  return defaultRegistry;
}

function clampTimeout(timeoutMs: number | undefined): { value: number; warning?: string } {
  const def = 30_000;
  if (timeoutMs === undefined) return { value: def };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { value: def, warning: `invalid timeout ${timeoutMs}; using ${def}ms` };
  }
  const min = 1_000;
  const max = 600_000;
  if (timeoutMs < min) return { value: min, warning: `timeout clamped up to ${min}ms` };
  if (timeoutMs > max) return { value: max, warning: `timeout clamped down to ${max}ms` };
  return { value: timeoutMs };
}

/** Pure: given pre/post balances + decoded instructions, produce the narrative. */
export function buildExplanation(input: ExplainInput): ExplainResult {
  const deltas = diffBalances(input.pre, input.post);

  // Enrich token deltas with known symbols if absent.
  for (const d of deltas) {
    if (d.asset.kind === 'token' && d.asset.symbol === undefined) {
      const sym = resolveSymbol(d.asset.mint);
      if (sym) d.asset.symbol = sym;
    }
  }

  const allTokenBalances = [...input.pre.tokenBalances, ...input.post.tokenBalances];

  const correlation = correlate({
    instructions: input.instructions,
    ...(input.innerInstructions ? { innerInstructions: input.innerInstructions } : {}),
    deltas,
    tokenBalances: allTokenBalances,
    registry: input.registry,
  });

  const summary = summarize({
    actions: correlation.actions,
    deltas,
    programsInvoked: correlation.programsInvoked,
    feePayer: input.feePayer,
    feeLamports: input.feeLamports,
    success: input.success,
    ...(input.error ? { error: input.error } : {}),
    ...(input.focusAccount ? { focusAccount: input.focusAccount } : {}),
  });

  const warnings = [...(input.warnings ?? []), ...correlation.warnings];

  const result: ExplainResult = {
    source: input.source,
    ...(input.signature ? { signature: input.signature } : {}),
    success: input.success,
    ...(input.error ? { error: input.error } : {}),
    ...(input.slot !== undefined ? { slot: input.slot } : {}),
    ...(input.blockTime !== undefined ? { blockTime: input.blockTime } : {}),
    feeLamports: input.feeLamports,
    ...(input.computeUnits !== undefined ? { computeUnits: input.computeUnits } : {}),
    feePayer: input.feePayer,
    summary,
    actions: correlation.actions,
    balanceChanges: deltas,
    instructions: correlation.decoded,
    accountsCreated: correlation.accountsCreated,
    approvals: correlation.approvals,
    programsInvoked: correlation.programsInvoked,
    warnings,
    ...(input.includeRaw && input.raw !== undefined ? { raw: input.raw } : {}),
  };
  return result;
}

function normalizedToResult(
  norm: NormalizedTx,
  registry: ProgramRegistry,
  opts: ExplainOptions,
  extraWarnings: { code: import('./types.js').WarningCode; message: string }[],
): ExplainResult {
  const input: ExplainInput = {
    source: norm.source,
    ...(norm.signature ? { signature: norm.signature } : {}),
    feePayer: norm.feePayer,
    success: norm.success,
    ...(norm.error ? { error: norm.error } : {}),
    ...(norm.slot !== undefined ? { slot: norm.slot } : {}),
    blockTime: norm.blockTime ?? null,
    feeLamports: norm.feeLamports,
    ...(norm.computeUnits !== undefined ? { computeUnits: norm.computeUnits } : {}),
    pre: norm.pre,
    post: norm.post,
    instructions: norm.instructions,
    ...(norm.innerInstructions ? { innerInstructions: norm.innerInstructions } : {}),
    registry,
    ...(opts.focusAccount ? { focusAccount: opts.focusAccount } : {}),
    warnings: [...norm.warnings, ...extraWarnings],
    ...(opts.includeRaw && norm.raw !== undefined ? { raw: norm.raw } : {}),
    ...(opts.includeRaw ? { includeRaw: true } : {}),
  };
  const result = buildExplanation(input);
  // Record the commitment a signature was read at, so the renderer tells the
  // truth instead of assuming 'confirmed'. (Simulation has no commitment.)
  if (norm.source === 'signature' && opts.commitment) {
    result.commitment = opts.commitment;
  }
  return result;
}

// ---------------------------------------------------------------------------
// explainSignature
// ---------------------------------------------------------------------------

export async function explainSignature(
  signature: string,
  options: ExplainSignatureOptions,
): Promise<ExplainResult> {
  try {
    const { value: timeoutMs, warning } = clampTimeout(options.timeoutMs);
    const rpc = resolveRpc(options.rpc, timeoutMs);
    const registry = resolveRegistry(options);
    const commitment: Commitment = options.commitment ?? 'confirmed';

    const norm = await acquireFromSignature({
      rpc,
      signature,
      commitment,
      maxSupportedTransactionVersion: options.maxSupportedTransactionVersion ?? 0,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.includeRaw ? { includeRaw: true } : {}),
    });

    const extra = warning ? [{ code: 'version-skew' as const, message: warning }] : [];
    return normalizedToResult(norm, registry, options, extra);
  } catch (err) {
    throw asExplainError(err, 'failed to explain signature');
  }
}

// ---------------------------------------------------------------------------
// explainTransaction
// ---------------------------------------------------------------------------

export async function explainTransaction(
  tx: string | Uint8Array,
  options: ExplainTransactionOptions,
): Promise<ExplainResult> {
  try {
    const { value: timeoutMs, warning } = clampTimeout(options.timeoutMs);
    const rpc = resolveRpc(options.rpc, timeoutMs);
    const registry = resolveRegistry(options);
    const commitment: Commitment = options.commitment ?? 'confirmed';

    let bytes: Uint8Array;
    let ambiguous = false;
    if (tx instanceof Uint8Array) {
      const det = detectInput(tx);
      if (det.kind !== 'tx-bytes') {
        throw new InputError('INVALID_INPUT', 'Provided bytes are not a serialized transaction.');
      }
      bytes = det.bytes;
    } else {
      const det = detectTxBytes(tx, options.encoding ?? 'auto');
      bytes = det.bytes;
      ambiguous = det.ambiguous;
    }

    const norm = await acquireFromSimulation({
      rpc,
      txBytes: bytes,
      commitment,
      replaceRecentBlockhash: options.replaceRecentBlockhash ?? true,
      sigVerify: options.sigVerify ?? false,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.includeRaw ? { includeRaw: true } : {}),
    });

    const extra: { code: import('./types.js').WarningCode; message: string }[] = [];
    if (ambiguous) {
      extra.push({
        code: 'version-skew',
        message: 'input was decodable as both base64 and base58; interpreted as base64',
      });
    }
    if (warning) extra.push({ code: 'version-skew', message: warning });

    return normalizedToResult(norm, registry, options, extra);
  } catch (err) {
    throw asExplainError(err, 'failed to explain transaction');
  }
}

// ---------------------------------------------------------------------------
// explainInstructions
// ---------------------------------------------------------------------------

export async function explainInstructions(
  instructions: ExplainInstruction[],
  options: ExplainInstructionsOptions,
): Promise<ExplainResult> {
  try {
    if (!options.feePayer || options.feePayer.trim().length === 0) {
      throw new InputError(
        'INVALID_INPUT',
        'feePayer is required to assemble a simulatable message from instructions.',
        { hint: 'Pass options.feePayer with the payer pubkey.' },
      );
    }
    if (!Array.isArray(instructions) || instructions.length === 0) {
      throw new InputError('EMPTY_INPUT', 'No instructions provided.');
    }

    const { value: timeoutMs, warning } = clampTimeout(options.timeoutMs);
    const rpc = resolveRpc(options.rpc, timeoutMs);
    const registry = resolveRegistry(options);
    const commitment: Commitment = options.commitment ?? 'confirmed';

    // Need a recent blockhash to assemble a simulatable message; replaced by
    // the node anyway (replaceRecentBlockhash:true).
    let blockhash: string;
    try {
      const bh = await rpc.getLatestBlockhash({
        commitment,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      blockhash = bh.blockhash;
    } catch {
      // Fall back to an all-1s placeholder; node will replace it.
      blockhash = '11111111111111111111111111111111';
    }

    const txBytes = buildLegacyMessage(instructions, options.feePayer, blockhash);

    const norm = await acquireFromSimulation({
      rpc,
      txBytes,
      commitment,
      replaceRecentBlockhash: true,
      sigVerify: false,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.includeRaw ? { includeRaw: true } : {}),
    });

    const extra = warning ? [{ code: 'version-skew' as const, message: warning }] : [];
    return normalizedToResult(norm, registry, options, extra);
  } catch (err) {
    throw asExplainError(err, 'failed to explain instructions');
  }
}

// ---------------------------------------------------------------------------
// explain (auto-detect)
// ---------------------------------------------------------------------------

export async function explain(
  input: string | Uint8Array | ExplainInstruction[],
  options: ExplainOptions,
): Promise<ExplainResult> {
  try {
    const detected = detectInput(input);
    switch (detected.kind) {
      case 'signature':
        return await explainSignature(detected.signature, options as ExplainSignatureOptions);
      case 'tx-bytes':
        return await explainTransaction(detected.bytes, {
          ...options,
          encoding: detected.encoding,
        });
      case 'instruction-set': {
        const opts = options as ExplainInstructionsOptions;
        if (!opts.feePayer) {
          throw new InputError(
            'INVALID_INPUT',
            'Instruction-set input requires options.feePayer.',
            { hint: 'Add feePayer to options.' },
          );
        }
        return await explainInstructions(detected.instructions, opts);
      }
    }
  } catch (err) {
    throw asExplainError(err, 'failed to explain input');
  }
}

/** Ensure only SolanaExplainError subclasses escape. */
function asExplainError(err: unknown, context: string): SolanaExplainError {
  if (err instanceof SolanaExplainError) return err;
  return wrapError(err, 'INVALID_INPUT', context);
}

export { SimulationError };
