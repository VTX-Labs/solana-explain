/**
 * Program ID → friendly name/kind map.
 *
 * Used both by the bundled decoders (for their own IDs) and by best-effort
 * recognition (name-only) for programs we don't byte-decode.
 */

import type { KnownProgramInfo } from '../types.js';

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const MEMO_V1_PROGRAM_ID = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

export const KNOWN_PROGRAMS: Readonly<Record<string, KnownProgramInfo>> = Object.freeze({
  // Core / decoded
  [SYSTEM_PROGRAM_ID]: { name: 'System', kind: 'system' },
  [TOKEN_PROGRAM_ID]: { name: 'SPL Token', kind: 'token' },
  [TOKEN_2022_PROGRAM_ID]: { name: 'Token-2022', kind: 'token-2022' },
  [ASSOCIATED_TOKEN_PROGRAM_ID]: { name: 'Associated Token Account', kind: 'ata' },
  [MEMO_PROGRAM_ID]: { name: 'Memo', kind: 'memo' },
  [MEMO_V1_PROGRAM_ID]: { name: 'Memo (v1)', kind: 'memo' },
  [COMPUTE_BUDGET_PROGRAM_ID]: { name: 'Compute Budget', kind: 'compute-budget' },

  // Native
  Stake11111111111111111111111111111111111111: { name: 'Stake', kind: 'stake' },
  Vote111111111111111111111111111111111111111: { name: 'Vote', kind: 'vote' },
  BPFLoaderUpgradeab1e11111111111111111111111: { name: 'BPF Upgradeable Loader', kind: 'loader' },
  BPFLoader2111111111111111111111111111111111: { name: 'BPF Loader 2', kind: 'loader' },
  AddressLookupTab1e1111111111111111111111111: {
    name: 'Address Lookup Table',
    kind: 'other',
  },

  // Metaplex
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: {
    name: 'Metaplex Token Metadata',
    kind: 'nft',
  },
  BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY: {
    name: 'Metaplex Bubblegum',
    kind: 'nft',
  },
  cndy3Z4yxLzowg4ZTHTHJYjBmtkk3vd6yMJ4r8x7q3o: {
    name: 'Metaplex Candy Machine',
    kind: 'nft',
  },

  // Aggregators / DEX
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: { name: 'Jupiter v6', kind: 'aggregator' },
  JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WconZX: { name: 'Jupiter v4', kind: 'aggregator' },
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': { name: 'Raydium AMM v4', kind: 'amm' },
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: { name: 'Raydium CLMM', kind: 'amm' },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { name: 'Orca Whirlpool', kind: 'amm' },
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': { name: 'Orca v2', kind: 'amm' },
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: { name: 'Phoenix', kind: 'amm' },
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: { name: 'Meteora DLMM', kind: 'amm' },
});

/** Look up a known program's info, or `undefined`. */
export function knownProgram(programId: string): KnownProgramInfo | undefined {
  return KNOWN_PROGRAMS[programId];
}
