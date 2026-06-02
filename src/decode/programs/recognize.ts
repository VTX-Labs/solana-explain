/**
 * Best-effort, name-only recognizers for programs we do not byte-decode
 * (Jupiter, Metaplex, Raydium, Orca, Stake, Vote, BPF loaders, …).
 *
 * These set `program` + a `program-call` action; the actual "what changed" is
 * inferred from the balance diff + CPI transfers in the correlation layer.
 */

import type { ProgramDecoder } from '../../types.js';
import { KNOWN_PROGRAMS } from '../known-programs.js';

const ALREADY_DECODED = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
  'ComputeBudget111111111111111111111111111111',
]);

/**
 * Build name-only decoders for every {@link KNOWN_PROGRAMS} entry that doesn't
 * already have a byte-level decoder. They never throw; they mark the
 * instruction recognized-but-undecoded and emit a `program-call`-friendly
 * output for the correlation layer.
 */
export function buildRecognizers(): ProgramDecoder[] {
  const decoders: ProgramDecoder[] = [];
  for (const [programId, info] of Object.entries(KNOWN_PROGRAMS)) {
    if (ALREADY_DECODED.has(programId)) continue;
    decoders.push({
      programId,
      name: info.name,
      kind: info.kind,
      decode: () => ({
        program: info.name,
        decoded: false,
        // Honest signal: we know *who* but not the exact ix semantics.
        warning: `${info.name} recognized by program id; semantics inferred from balance diff (no IDL)`,
      }),
    });
  }
  return decoders;
}
