/**
 * Shared test helpers: build deterministic wire transactions and mock RPC
 * responses without touching the network.
 */

import bs58 from 'bs58';
import type {
  CompiledInstructionView,
  ExplainInstruction,
  RpcClient,
} from '../src/index.js';
import type {
  RawAccount,
  RawSimulateResponse,
  RawTransactionResponse,
  GetTransactionOpts,
  SimulateOpts,
  GetAccountsOpts,
} from '../src/rpc/types.js';
import { buildLegacyMessage } from '../src/decode/build-message.js';

// Stable, valid 32-byte pubkeys for tests.
export function pk(seed: number): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = (seed * 31 + i * 7) % 256;
  // Avoid all-zero (the System program id) collisions by tagging first byte.
  bytes[0] = (seed + 1) % 256;
  return bs58.encode(bytes);
}

export const SYSTEM = '11111111111111111111111111111111';
export const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
export const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const WSOL = 'So11111111111111111111111111111111111111112';

/** Build a System.transfer instruction. */
export function systemTransferIx(
  from: string,
  to: string,
  lamports: bigint,
): ExplainInstruction {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // discriminator
  view.setBigUint64(4, lamports, true);
  return {
    programId: SYSTEM,
    accounts: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data,
  };
}

/** Build an SPL Token transferChecked instruction. */
export function transferCheckedIx(
  source: string,
  mint: string,
  dest: string,
  authority: string,
  amount: bigint,
  decimals: number,
  programId: string = TOKEN,
): ExplainInstruction {
  const data = new Uint8Array(10);
  const view = new DataView(data.buffer);
  view.setUint8(0, 12); // transferChecked
  view.setBigUint64(1, amount, true);
  view.setUint8(9, decimals);
  return {
    programId,
    accounts: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  };
}

/** Build a Memo instruction. */
export function memoIx(text: string): ExplainInstruction {
  return {
    programId: MEMO,
    accounts: [],
    data: new TextEncoder().encode(text),
  };
}

/** Build a ComputeBudget setComputeUnitLimit instruction. */
export function computeUnitLimitIx(units: number): ExplainInstruction {
  const data = new Uint8Array(5);
  const view = new DataView(data.buffer);
  view.setUint8(0, 2);
  view.setUint32(1, units, true);
  return { programId: COMPUTE_BUDGET, accounts: [], data };
}

/** Compile a set of ExplainInstructions to a CompiledInstructionView list using a fee payer + blockhash. */
export function compile(
  instructions: ExplainInstruction[],
  feePayer: string,
): { txBytes: Uint8Array } {
  const txBytes = buildLegacyMessage(instructions, feePayer, SYSTEM);
  return { txBytes };
}

/** A jsonParsed token account state for getMultipleAccounts / simulate accounts. */
export function tokenAccount(
  mint: string,
  owner: string,
  amount: string,
  decimals: number,
  lamports = 2_039_280,
  program: 'spl-token' | 'spl-token-2022' = 'spl-token',
): RawAccount {
  return {
    lamports,
    owner: program === 'spl-token' ? TOKEN : TOKEN_2022,
    executable: false,
    data: {
      program,
      parsed: {
        type: 'account',
        info: {
          mint,
          owner,
          tokenAmount: { amount, decimals, uiAmount: Number(amount) / 10 ** decimals },
        },
      },
    },
  };
}

/** A plain system account state. */
export function systemAccount(lamports: number): RawAccount {
  return { lamports, owner: SYSTEM, executable: false, data: ['', 'base64'] };
}

/** Build a mock RpcClient from a script of method responses. */
export interface MockScript {
  getTransaction?: (sig: string, opts: GetTransactionOpts) => RawTransactionResponse | null;
  simulateTransaction?: (txBase64: string, opts: SimulateOpts) => RawSimulateResponse;
  getMultipleAccounts?: (addresses: string[], opts: GetAccountsOpts) => (RawAccount | null)[];
  getLatestBlockhash?: () => { blockhash: string; lastValidBlockHeight: number };
}

export function mockRpc(script: MockScript): RpcClient {
  return {
    async getTransaction(sig, opts) {
      if (!script.getTransaction) throw new Error('getTransaction not scripted');
      return script.getTransaction(sig, opts);
    },
    async simulateTransaction(txBase64, opts) {
      if (!script.simulateTransaction) throw new Error('simulateTransaction not scripted');
      return script.simulateTransaction(txBase64, opts);
    },
    async getMultipleAccounts(addresses, opts) {
      if (!script.getMultipleAccounts) return addresses.map(() => null);
      return script.getMultipleAccounts(addresses, opts);
    },
    async getLatestBlockhash() {
      if (!script.getLatestBlockhash)
        return { blockhash: SYSTEM, lastValidBlockHeight: 1 };
      return script.getLatestBlockhash();
    },
  };
}

/** Build a getTransaction (base64 message) response from a tx + balances. */
export function buildSignatureResponse(args: {
  txBytes: Uint8Array;
  accountKeys: string[];
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: RawTransactionResponse['meta'] extends infer M
    ? M extends { preTokenBalances?: infer P }
      ? P
      : never
    : never;
  postTokenBalances?: unknown;
  fee?: number;
  err?: unknown;
  slot?: number;
  blockTime?: number | null;
  computeUnitsConsumed?: number;
}): RawTransactionResponse {
  // Strip leading signatures to get the message bytes for base64 message.
  const messageBytes = stripSigsForFixture(args.txBytes);
  const msgB64 = Buffer.from(messageBytes).toString('base64');
  return {
    slot: args.slot ?? 100,
    blockTime: args.blockTime ?? 1_717_000_000,
    version: 'legacy',
    meta: {
      err: args.err ?? null,
      fee: args.fee ?? 5000,
      preBalances: args.preBalances,
      postBalances: args.postBalances,
      preTokenBalances: (args.preTokenBalances as never) ?? [],
      postTokenBalances: (args.postTokenBalances as never) ?? [],
      innerInstructions: [],
      ...(args.computeUnitsConsumed !== undefined
        ? { computeUnitsConsumed: args.computeUnitsConsumed }
        : {}),
    },
    transaction: {
      signatures: [bs58.encode(new Uint8Array(64))],
      message: [msgB64, 'base64'],
    },
  };
}

function stripSigsForFixture(txBytes: Uint8Array): Uint8Array {
  // Our buildLegacyMessage prefixes compact-u16 sig count + 64*n sig bytes.
  // Reproduce the strip: read compact-u16, skip sigs.
  let offset = 0;
  let sigCount = 0;
  let shift = 0;
  for (let i = 0; i < 3; i++) {
    const byte = txBytes[offset++]!;
    sigCount |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return txBytes.subarray(offset + sigCount * 64);
}

/** Decode a single instruction view from a built message for decoder tests. */
export function viewOf(ix: ExplainInstruction, index = 0): CompiledInstructionView {
  let data: Uint8Array;
  if (ix.data instanceof Uint8Array) data = ix.data;
  else if (Array.isArray(ix.data)) data = Uint8Array.from(ix.data);
  else data = bs58.decode(ix.data);
  return {
    index,
    programId: ix.programId,
    accounts: ix.accounts.map((a) => ({
      pubkey: a.pubkey,
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data,
  };
}
