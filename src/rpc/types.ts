/**
 * The RpcClient interface + raw RPC response shapes.
 *
 * The library only ever talks to {@link RpcClient}, which makes it
 * network-source-agnostic and keeps `@solana/web3.js` an optional peer dep.
 */

import type { Commitment } from '../types.js';

export interface GetTransactionOpts {
  commitment?: Commitment;
  maxSupportedTransactionVersion?: number;
  signal?: AbortSignal;
}

export interface SimulateOpts {
  commitment?: Commitment;
  sigVerify?: boolean;
  replaceRecentBlockhash?: boolean;
  /** Accounts to return post-state for (jsonParsed). */
  accounts?: { addresses: string[]; encoding?: 'jsonParsed' | 'base64' };
  innerInstructions?: boolean;
  signal?: AbortSignal;
}

export interface GetAccountsOpts {
  commitment?: Commitment;
  encoding?: 'jsonParsed' | 'base64';
  signal?: AbortSignal;
}

export interface RpcClient {
  getTransaction(sig: string, opts: GetTransactionOpts): Promise<RawTransactionResponse | null>;
  simulateTransaction(txBase64: string, opts: SimulateOpts): Promise<RawSimulateResponse>;
  getMultipleAccounts(addresses: string[], opts: GetAccountsOpts): Promise<(RawAccount | null)[]>;
  getLatestBlockhash(
    opts?: { commitment?: Commitment; signal?: AbortSignal },
  ): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
}

// ---------------------------------------------------------------------------
// Raw RPC shapes (subset of what we consume). Untyped fields are `unknown`.
// ---------------------------------------------------------------------------

export interface RawTokenAmount {
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString?: string;
}

export interface RawTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: RawTokenAmount;
}

export interface RawInstructionCompiled {
  programIdIndex: number;
  accounts: number[];
  data: string; // base58 in legacy "json" encoding
}

export interface RawInnerInstructions {
  index: number;
  instructions: RawInstructionCompiled[];
}

export interface RawLoadedAddresses {
  writable: string[];
  readonly: string[];
}

export interface RawTransactionMeta {
  err: unknown;
  fee: number;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: RawTokenBalance[];
  postTokenBalances?: RawTokenBalance[];
  innerInstructions?: RawInnerInstructions[];
  loadedAddresses?: RawLoadedAddresses;
  computeUnitsConsumed?: number;
  logMessages?: string[];
}

export interface RawMessageHeader {
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
}

export interface RawTransactionResponse {
  slot: number;
  blockTime: number | null;
  version?: number | 'legacy';
  meta: RawTransactionMeta | null;
  transaction: {
    signatures: string[];
    /** We request base64 message encoding so we can decode roles ourselves. */
    message: string | unknown;
  };
}

export interface RawSimulateValue {
  err: unknown;
  logs: string[] | null;
  unitsConsumed?: number;
  accounts?: (RawAccount | null)[];
  innerInstructions?: RawInnerInstructions[];
  returnData?: unknown;
}

export interface RawSimulateResponse {
  context: { slot: number };
  value: RawSimulateValue;
}

export interface RawAccount {
  lamports: number;
  owner: string;
  data: unknown; // jsonParsed object | [base64, 'base64'] | base64 string
  executable: boolean;
  rentEpoch?: number | string;
  space?: number;
}
