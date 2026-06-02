/**
 * All shared public types & interfaces for solana-explain.
 *
 * All numeric on-chain quantities are `bigint`; `ui*` string fields carry
 * human/decimal formatting so callers never lose precision.
 */

import type { RpcClient } from './rpc/types.js';

export type { RpcClient } from './rpc/types.js';
export type {
  GetTransactionOpts,
  SimulateOpts,
  GetAccountsOpts,
  RawTransactionResponse,
  RawSimulateResponse,
  RawAccount,
} from './rpc/types.js';

export type Commitment = 'processed' | 'confirmed' | 'finalized';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ExplainOptions {
  /** RPC URL string OR a pre-built {@link RpcClient}. Required (no default endpoint, to avoid abuse). */
  rpc: string | RpcClient;
  /** Commitment level for reads/sim. Default `'confirmed'`. */
  commitment?: Commitment;
  /** Extra/override program decoders. Merged over {@link defaultRegistry}. */
  registry?: ProgramRegistry;
  /** AbortSignal for cancellation; all RPC calls honor it. */
  signal?: AbortSignal;
  /** Per-call timeout in ms. Default `30_000`. */
  timeoutMs?: number;
  /** "Whose view" to phrase deltas from. Highlights this account in output. */
  focusAccount?: string;
  /** Attach the raw RPC payload under {@link ExplainResult.raw}. */
  includeRaw?: boolean;
}

export interface ExplainSignatureOptions extends ExplainOptions {
  /** Max supported tx version for `getTransaction`. Default `0` (versioned txs). */
  maxSupportedTransactionVersion?: number;
}

export interface ExplainTransactionOptions extends ExplainOptions {
  /** Input encoding. Default `'auto'`. */
  encoding?: 'base64' | 'base58' | 'auto';
  /** Let simulation run unsigned. Default `true`. */
  replaceRecentBlockhash?: boolean;
  /** Verify signatures during simulation. Default `false`. */
  sigVerify?: boolean;
}

export interface ExplainInstructionsOptions extends ExplainOptions {
  /** Required to assemble a simulatable message. */
  feePayer: string;
}

// ---------------------------------------------------------------------------
// Instruction input (for explainInstructions)
// ---------------------------------------------------------------------------

export interface ExplainInstructionAccount {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface ExplainInstruction {
  programId: string;
  accounts: ExplainInstructionAccount[];
  /** Base64 or base58 encoded instruction data, OR a raw byte array. */
  data: string | Uint8Array | number[];
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ExplainResult {
  source: 'signature' | 'simulation';
  signature?: string;
  /** Commitment level the result was read at (signature source only). */
  commitment?: Commitment;
  /** `false` if on-chain err or sim err. */
  success: boolean;
  error?: { raw: unknown; human: string };
  slot?: number;
  blockTime?: number | null;
  feeLamports: bigint;
  computeUnits?: number;
  feePayer: string;
  /** One-line plain-English headline. */
  summary: string;
  actions: Action[];
  balanceChanges: BalanceDelta[];
  instructions: DecodedInstruction[];
  accountsCreated: AccountCreation[];
  approvals: Approval[];
  programsInvoked: ProgramInvocation[];
  warnings: Warning[];
  /** Attached only when {@link ExplainOptions.includeRaw}. */
  raw?: unknown;
}

export type Action =
  | { kind: 'sol-transfer'; from: string; to: string; lamports: bigint; sol: string }
  | {
      kind: 'token-transfer';
      from: string;
      to: string;
      mint: string;
      amount: bigint;
      uiAmount: string;
      decimals: number;
      symbol?: string;
      tokenProgram: 'spl-token' | 'token-2022';
    }
  | { kind: 'mint'; mint: string; to: string; amount: bigint; uiAmount: string }
  | { kind: 'burn'; mint: string; from: string; amount: bigint; uiAmount: string }
  | {
      kind: 'account-created';
      address: string;
      owner: string;
      lamports: bigint;
      space?: number;
      as?: 'token-account' | 'mint' | 'ata' | 'system';
    }
  | {
      kind: 'approval';
      owner: string;
      delegate: string;
      mint: string;
      amount: bigint | 'unlimited';
      revoke?: boolean;
    }
  | { kind: 'close-account'; account: string; destination: string; reclaimedLamports: bigint }
  | { kind: 'memo'; text: string }
  | { kind: 'compute-budget'; unitLimit?: number; unitPriceMicroLamports?: bigint }
  | {
      kind: 'program-call';
      programId: string;
      program?: string;
      instruction?: string;
      note?: string;
    };

export interface BalanceDelta {
  account: string;
  asset:
    | { kind: 'SOL' }
    | { kind: 'token'; mint: string; decimals: number; symbol?: string; tokenProgram: string };
  pre: bigint;
  post: bigint;
  /** Signed: `post - pre`. */
  delta: bigint;
  /** Human, e.g. `"-1.5 SOL"`, `"+250 USDC"`. */
  uiDelta: string;
  /** For token accounts. */
  owner?: string;
}

export interface DecodedInstruction {
  index: number;
  programId: string;
  /** Recognized program name (e.g. `"SPL Token"`). */
  program?: string;
  /** Recognized instruction name (e.g. `"transferChecked"`). */
  type?: string;
  /** `false` => only programId recognized, or fully unknown. */
  decoded: boolean;
  accounts: { pubkey: string; name?: string; isSigner: boolean; isWritable: boolean }[];
  /** Stringified bigints to keep the structure JSON-safe. */
  args?: Record<string, string | number | boolean>;
  /** CPI tree when meta.innerInstructions present. */
  inner?: DecodedInstruction[];
  warning?: string;
}

export interface AccountCreation {
  address: string;
  owner: string;
  lamports: bigint;
  space?: number;
  as?: 'token-account' | 'mint' | 'ata' | 'system';
}

export interface Approval {
  owner: string;
  delegate: string;
  mint: string;
  amount: bigint | 'unlimited';
  revoke?: boolean;
}

export interface ProgramInvocation {
  programId: string;
  /** Recognized name (e.g. `"Jupiter v6"`). */
  name?: string;
  count: number;
}

export interface Warning {
  code: WarningCode;
  message: string;
  instructionIndex?: number;
}

export type WarningCode =
  | 'unknown-program'
  | 'partial-decode'
  | 'ambiguous-amount'
  | 'token-2022-extension-unparsed'
  | 'lut-unresolved'
  | 'simulation-failed'
  | 'version-skew'
  | 'inner-instructions-missing';

// ---------------------------------------------------------------------------
// Decode layer public surface
// ---------------------------------------------------------------------------

/** One instruction as resolved from a wire message, with per-account roles. */
export interface CompiledInstructionView {
  index: number;
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}

export type ProgramKind =
  | 'system'
  | 'token'
  | 'token-2022'
  | 'ata'
  | 'memo'
  | 'compute-budget'
  | 'stake'
  | 'vote'
  | 'loader'
  | 'amm'
  | 'aggregator'
  | 'nft'
  | 'other';

export interface KnownProgramInfo {
  name: string;
  kind: ProgramKind;
}

/** Result of decoding a single instruction. */
export interface DecodeOutput {
  program?: string;
  type?: string;
  decoded: boolean;
  /** Stringified bigints / scalars. */
  args?: Record<string, string | number | boolean>;
  /** Optional friendly names for the instruction's accounts, by index. */
  accountNames?: (string | undefined)[];
  warning?: string;
  warningCode?: WarningCode;
  /**
   * Structured side-effects this decoder is *certain* about (e.g. a decoded
   * `transferChecked` knows the exact mint and amount). The correlation layer
   * fuses these with the balance diff.
   */
  effects?: DecoderEffect[];
}

/** Certain, structured effects emitted by a decoder, consumed by `correlate()`. */
export type DecoderEffect =
  | {
      kind: 'sol-transfer';
      from: string;
      to: string;
      lamports: bigint;
    }
  | {
      kind: 'token-transfer';
      from: string;
      to: string;
      mint?: string;
      amount: bigint;
      decimals?: number;
      tokenProgram: 'spl-token' | 'token-2022';
    }
  | { kind: 'mint'; mint: string; to: string; amount: bigint; decimals?: number }
  | { kind: 'burn'; mint: string; from: string; amount: bigint; decimals?: number }
  | {
      kind: 'approval';
      owner: string;
      delegate: string;
      mint: string;
      amount: bigint | 'unlimited';
      revoke?: boolean;
    }
  | { kind: 'close-account'; account: string; destination: string }
  | {
      kind: 'account-created';
      address: string;
      owner: string;
      lamports?: bigint;
      space?: number;
      as?: 'token-account' | 'mint' | 'ata' | 'system';
    }
  | { kind: 'memo'; text: string }
  | { kind: 'compute-budget'; unitLimit?: number; unitPriceMicroLamports?: bigint }
  | { kind: 'sync-native'; account: string };

export interface ProgramDecoder {
  /** Program ID(s) this decoder handles. */
  programId: string;
  /** Friendly program name. */
  name: string;
  kind: ProgramKind;
  /** Decode an instruction. MUST NOT throw; return `{ decoded: false }` on failure. */
  decode(ix: CompiledInstructionView): DecodeOutput;
}

export interface ProgramRegistry {
  get(programId: string): ProgramDecoder | undefined;
  has(programId: string): boolean;
  /** All registered decoders. */
  list(): ProgramDecoder[];
  /** Return a new registry with `decoders` merged over this one. */
  merge(decoders: ProgramDecoder[]): ProgramRegistry;
}

// ---------------------------------------------------------------------------
// buildExplanation input (pure entry point)
// ---------------------------------------------------------------------------

export interface BalanceSnapshot {
  /** Account keys in message order. */
  accountKeys: string[];
  /** Lamport balance per account key index. */
  lamports: bigint[];
  /** Token balances keyed loosely; matched by account address + mint. */
  tokenBalances: TokenBalanceEntry[];
}

export interface TokenBalanceEntry {
  /** Token account address. */
  account: string;
  mint: string;
  owner?: string;
  amount: bigint;
  decimals: number;
  /** Owning token program ('spl-token' | 'token-2022' | raw id). */
  tokenProgram: string;
  symbol?: string;
}

export interface ExplainInput {
  source: 'signature' | 'simulation';
  signature?: string;
  feePayer: string;
  success: boolean;
  error?: { raw: unknown; human: string };
  slot?: number;
  blockTime?: number | null;
  feeLamports: bigint;
  computeUnits?: number;
  pre: BalanceSnapshot;
  post: BalanceSnapshot;
  instructions: CompiledInstructionView[];
  /** Inner instructions per top-level index, when available. */
  innerInstructions?: { index: number; instructions: CompiledInstructionView[] }[];
  registry: ProgramRegistry;
  focusAccount?: string;
  warnings?: Warning[];
  raw?: unknown;
  includeRaw?: boolean;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RenderOptions {
  /** Force-enable ANSI color. When omitted, the renderer leaves output plain. */
  color?: boolean;
  /** Show every instruction including the inner/CPI tree + raw args. */
  verbose?: boolean;
  /** Only print the summary line. */
  quiet?: boolean;
}
