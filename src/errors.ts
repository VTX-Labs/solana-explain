/**
 * Error hierarchy for solana-explain.
 *
 * Every public async function rejects ONLY with a {@link SolanaExplainError}
 * subclass. Raw/underlying errors are always wrapped and preserved on `.cause`.
 */

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_SIGNATURE'
  | 'INVALID_ENCODING'
  | 'EMPTY_INPUT'
  | 'TX_NOT_FOUND'
  | 'RPC_HTTP'
  | 'RPC_JSON'
  | 'RPC_TIMEOUT'
  | 'ABORTED'
  | 'DECODE_FAILED'
  | 'SIMULATION_REJECTED'
  | 'UNSUPPORTED_TX_VERSION';

export interface SolanaExplainErrorOptions {
  cause?: unknown;
  /** Optional human hint surfaced by the CLI alongside the message. */
  hint?: string;
}

/** Base class. Never thrown directly by public functions — only its subclasses. */
export class SolanaExplainError extends Error {
  readonly code: ErrorCode;
  override readonly cause?: unknown;
  /** Optional, CLI-friendly remediation hint. */
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, options: SolanaExplainErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options.cause !== undefined) this.cause = options.cause;
    if (options.hint !== undefined) this.hint = options.hint;
    // Maintain prototype chain across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Transport / JSON-RPC error (HTTP failure, malformed JSON, JSON-RPC error object, timeout). */
export class RpcError extends SolanaExplainError {}

/** Malformed transaction bytes / wire message. */
export class DecodeError extends SolanaExplainError {}

/**
 * Simulation produced a runtime error (the tx would fail). Still carries a
 * partial {@link import('./types').ExplainResult} on `.result` when available,
 * because the user usually wants to know *why* it failed.
 *
 * Note: a node *rejecting* the simulation outright (bad blockhash, etc.) is a
 * different condition and is also surfaced as a `SimulationError`, with code
 * `SIMULATION_REJECTED`.
 */
export class SimulationError extends SolanaExplainError {
  /** Partial result when the simulation ran but reverted. */
  readonly result?: unknown;
  /** Tail of the node's program logs, for diagnostics. */
  readonly logs?: readonly string[];

  constructor(
    code: ErrorCode,
    message: string,
    options: SolanaExplainErrorOptions & { result?: unknown; logs?: readonly string[] } = {},
  ) {
    super(code, message, options);
    if (options.result !== undefined) this.result = options.result;
    if (options.logs !== undefined) this.logs = options.logs;
  }
}

/** Bad signature / encoding / empty input. */
export class InputError extends SolanaExplainError {}

/**
 * Wrap an unknown thrown value into a `SolanaExplainError` subclass, preserving
 * the original on `.cause`. Pass-through if it is already one of ours.
 */
export function wrapError(
  err: unknown,
  fallbackCode: ErrorCode,
  fallbackMessage: string,
): SolanaExplainError {
  if (err instanceof SolanaExplainError) return err;
  if (isAbortError(err)) {
    return new RpcError('ABORTED', 'The operation was aborted.', { cause: err });
  }
  const detail = err instanceof Error ? err.message : String(err);
  return new SolanaExplainError(fallbackCode, `${fallbackMessage}: ${detail}`, { cause: err });
}

/** Detect a DOMException/AbortError-style cancellation from any runtime. */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}
