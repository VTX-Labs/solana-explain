/**
 * @vtx-labs/solana-explain — public re-exports (named only).
 *
 * Turn any Solana transaction signature, raw/base64 transaction, or unsigned
 * instruction set into a plain-English "what this actually does" report.
 */

// ---- Primary one-shot helpers ----
export {
  explain,
  explainSignature,
  explainTransaction,
  explainInstructions,
  buildExplanation,
} from './explain.js';

// ---- Lower-level building blocks ----
export { decodeInstruction, defaultRegistry, createRegistry, KNOWN_PROGRAMS } from './decode/registry.js';
export { diffBalances } from './explain/diff.js';

// ---- Rendering ----
export { renderText, renderMarkdown, renderJson } from './render/index.js';

// ---- RPC abstraction ----
export { createHttpRpc } from './rpc/http.js';
export { fromWeb3Rpc } from './rpc/web3-adapter.js';

// ---- Errors ----
export {
  SolanaExplainError,
  RpcError,
  DecodeError,
  SimulationError,
  InputError,
} from './errors.js';

// ---- Types ----
export type {
  Commitment,
  ExplainOptions,
  ExplainSignatureOptions,
  ExplainTransactionOptions,
  ExplainInstructionsOptions,
  ExplainInstruction,
  ExplainInstructionAccount,
  ExplainResult,
  ExplainInput,
  Action,
  BalanceDelta,
  BalanceSnapshot,
  TokenBalanceEntry,
  DecodedInstruction,
  CompiledInstructionView,
  AccountCreation,
  Approval,
  ProgramInvocation,
  Warning,
  WarningCode,
  RenderOptions,
  ProgramDecoder,
  ProgramRegistry,
  DecodeOutput,
  DecoderEffect,
  KnownProgramInfo,
  ProgramKind,
  RpcClient,
  GetTransactionOpts,
  SimulateOpts,
  GetAccountsOpts,
  RawTransactionResponse,
  RawSimulateResponse,
  RawAccount,
} from './types.js';

export type { ErrorCode } from './errors.js';
export type { HttpRpcOptions } from './rpc/http.js';
