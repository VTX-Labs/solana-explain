/**
 * The `NormalizedTx` shape produced by both acquisition strategies and fed to
 * `buildExplanation`. Plus shared parsing of jsonParsed token-balance entries
 * and account states.
 */

import type {
  BalanceSnapshot,
  CompiledInstructionView,
  TokenBalanceEntry,
  Warning,
} from '../types.js';
import type {
  RawAccount,
  RawInnerInstructions,
  RawTokenBalance,
} from '../rpc/types.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../decode/known-programs.js';
import { resolveSymbol } from '../explain/token-meta.js';

export interface NormalizedTx {
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
  innerInstructions?: { index: number; instructions: CompiledInstructionView[] }[];
  warnings: Warning[];
  raw?: unknown;
}

/** Normalize a token-program id to the human key the decoder uses. */
export function tokenProgramKey(programId: string | undefined): string {
  if (programId === TOKEN_PROGRAM_ID) return 'spl-token';
  if (programId === TOKEN_2022_PROGRAM_ID) return 'token-2022';
  return programId ?? 'spl-token';
}

/** Convert RPC token-balance entries (indexed) into our account-keyed form. */
export function tokenBalancesFromMeta(
  entries: RawTokenBalance[] | undefined,
  accountKeys: string[],
): TokenBalanceEntry[] {
  if (!entries) return [];
  const out: TokenBalanceEntry[] = [];
  for (const e of entries) {
    const account = accountKeys[e.accountIndex];
    if (account === undefined) continue;
    const amount = BigInt(e.uiTokenAmount.amount);
    const symbol = resolveSymbol(e.mint);
    out.push({
      account,
      mint: e.mint,
      ...(e.owner !== undefined ? { owner: e.owner } : {}),
      amount,
      decimals: e.uiTokenAmount.decimals,
      tokenProgram: tokenProgramKey(e.programId),
      ...(symbol !== undefined ? { symbol } : {}),
    });
  }
  return out;
}

/**
 * Extract a token-balance entry from a jsonParsed account state (used by the
 * simulate path where we fetch/observe raw account states). Returns `null` if
 * the account isn't an SPL/Token-2022 token account.
 */
export function tokenBalanceFromAccount(
  address: string,
  account: RawAccount | null,
): TokenBalanceEntry | null {
  if (!account) return null;
  const data = account.data;
  if (
    typeof data !== 'object' ||
    data === null ||
    !('parsed' in data) ||
    !('program' in data)
  ) {
    return null;
  }
  const program = (data as { program?: unknown }).program;
  const parsed = (data as { parsed?: unknown }).parsed;
  if (
    (program !== 'spl-token' && program !== 'spl-token-2022') ||
    typeof parsed !== 'object' ||
    parsed === null
  ) {
    return null;
  }
  const info = (parsed as { info?: unknown; type?: unknown }).info;
  const type = (parsed as { type?: unknown }).type;
  if (type !== 'account' || typeof info !== 'object' || info === null) return null;
  const i = info as {
    mint?: unknown;
    owner?: unknown;
    tokenAmount?: { amount?: unknown; decimals?: unknown };
  };
  if (typeof i.mint !== 'string' || !i.tokenAmount) return null;
  const amountStr = i.tokenAmount.amount;
  const decimals = i.tokenAmount.decimals;
  if (typeof amountStr !== 'string' || typeof decimals !== 'number') return null;
  const symbol = resolveSymbol(i.mint);
  return {
    account: address,
    mint: i.mint,
    ...(typeof i.owner === 'string' ? { owner: i.owner } : {}),
    amount: BigInt(amountStr),
    decimals,
    tokenProgram: program === 'spl-token-2022' ? 'token-2022' : 'spl-token',
    ...(symbol !== undefined ? { symbol } : {}),
  };
}

/** Convert RPC inner-instruction groups into compiled views (already resolved keys). */
export function innerFromMeta(
  groups: RawInnerInstructions[] | undefined,
  accountKeys: string[],
  decodeData: (b58: string) => Uint8Array,
  isSigner: boolean[],
  isWritable: boolean[],
): { index: number; instructions: CompiledInstructionView[] }[] {
  if (!groups) return [];
  return groups.map((g) => ({
    index: g.index,
    instructions: g.instructions.map((ix, i) => {
      const programId = accountKeys[ix.programIdIndex] ?? '';
      return {
        index: i,
        programId,
        accounts: ix.accounts.map((ai) => ({
          pubkey: accountKeys[ai] ?? '',
          isSigner: isSigner[ai] ?? false,
          isWritable: isWritable[ai] ?? false,
        })),
        data: decodeData(ix.data),
      };
    }),
  }));
}
