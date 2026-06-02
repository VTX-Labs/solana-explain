/**
 * Program registry + `createRegistry` + `defaultRegistry` + `decodeInstruction`.
 *
 * This module is also the `@vtx-labs/solana-explain/programs` entry point, so
 * advanced consumers can register custom decoders without IDLs.
 */

import type {
  CompiledInstructionView,
  DecodedInstruction,
  ProgramDecoder,
  ProgramRegistry,
} from '../types.js';
import { knownProgram } from './known-programs.js';
import { systemDecoder } from './programs/system.js';
import { splTokenDecoder, token2022Decoder } from './programs/token-2022.js';
import { ataDecoder } from './programs/ata.js';
import { memoDecoder, memoV1Decoder } from './programs/memo.js';
import { computeBudgetDecoder } from './programs/compute-budget.js';
import { buildRecognizers } from './programs/recognize.js';

export { KNOWN_PROGRAMS, knownProgram } from './known-programs.js';
export type {
  ProgramDecoder,
  ProgramRegistry,
  DecodeOutput,
  DecoderEffect,
  CompiledInstructionView,
  KnownProgramInfo,
  ProgramKind,
} from '../types.js';

class Registry implements ProgramRegistry {
  private readonly map: Map<string, ProgramDecoder>;

  constructor(decoders: ProgramDecoder[]) {
    this.map = new Map();
    for (const d of decoders) this.map.set(d.programId, d);
  }

  get(programId: string): ProgramDecoder | undefined {
    return this.map.get(programId);
  }

  has(programId: string): boolean {
    return this.map.has(programId);
  }

  list(): ProgramDecoder[] {
    return [...this.map.values()];
  }

  merge(decoders: ProgramDecoder[]): ProgramRegistry {
    const merged = new Map(this.map);
    for (const d of decoders) merged.set(d.programId, d);
    return new Registry([...merged.values()]);
  }
}

/** Bundled byte-level decoders (precise semantics). */
export const BUNDLED_DECODERS: ProgramDecoder[] = [
  systemDecoder,
  splTokenDecoder,
  token2022Decoder,
  ataDecoder,
  memoDecoder,
  memoV1Decoder,
  computeBudgetDecoder,
];

/**
 * Create a registry. By default it includes the bundled byte-level decoders
 * plus name-only recognizers; pass `decoders` to merge overrides on top.
 */
export function createRegistry(decoders?: ProgramDecoder[]): ProgramRegistry {
  const base = [...BUNDLED_DECODERS, ...buildRecognizers()];
  const reg = new Registry(base);
  return decoders && decoders.length > 0 ? reg.merge(decoders) : reg;
}

/** The default registry (bundled decoders + recognizers). */
export const defaultRegistry: ProgramRegistry = createRegistry();

/**
 * Pure: decode one instruction against the registry. Returns `{ decoded:false }`
 * (never throws) for unrecognized programs.
 */
export function decodeInstruction(
  ix: CompiledInstructionView,
  registry: ProgramRegistry = defaultRegistry,
  /**
   * Optional pre-computed decode output. When the caller has already run the
   * decoder (see {@link decodeInstructionRaw}), passing it here avoids decoding
   * the instruction a second time across the whole CPI tree.
   */
  precomputed?: import('../types.js').DecodeOutput,
): DecodedInstruction {
  const decoder = registry.get(ix.programId);
  const known = knownProgram(ix.programId);

  const baseAccounts = ix.accounts.map((a) => ({
    pubkey: a.pubkey,
    isSigner: a.isSigner,
    isWritable: a.isWritable,
  }));

  if (!decoder) {
    return {
      index: ix.index,
      programId: ix.programId,
      ...(known ? { program: known.name } : {}),
      decoded: false,
      accounts: baseAccounts,
      warning: known
        ? `${known.name} recognized by program id (no byte decoder)`
        : 'unknown program (no decoder)',
    };
  }

  let out;
  try {
    out = precomputed ?? decoder.decode(ix);
  } catch (err) {
    // Decoders are contracted not to throw, but be defensive.
    return {
      index: ix.index,
      programId: ix.programId,
      program: decoder.name,
      decoded: false,
      accounts: baseAccounts,
      warning: `decoder error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const accounts = baseAccounts.map((a, i) => {
    const name = out.accountNames?.[i];
    return name !== undefined ? { ...a, name } : a;
  });

  return {
    index: ix.index,
    programId: ix.programId,
    ...(out.program !== undefined ? { program: out.program } : {}),
    ...(out.type !== undefined ? { type: out.type } : {}),
    decoded: out.decoded,
    accounts,
    ...(out.args !== undefined ? { args: out.args } : {}),
    ...(out.warning !== undefined ? { warning: out.warning } : {}),
  };
}

/** Internal helper to retain the structured effects for correlation. */
export function decodeInstructionRaw(
  ix: CompiledInstructionView,
  registry: ProgramRegistry = defaultRegistry,
): { decoded: DecodedInstruction; effects: import('../types.js').DecoderEffect[]; warningCode?: import('../types.js').WarningCode } {
  const decoder = registry.get(ix.programId);
  if (!decoder) return { decoded: decodeInstruction(ix, registry), effects: [] };
  let out;
  try {
    out = decoder.decode(ix); // decode ONCE
  } catch {
    return { decoded: decodeInstruction(ix, registry), effects: [] };
  }
  // Reuse the single decode output for the human view (no second decode).
  const decoded = decodeInstruction(ix, registry, out);
  return {
    decoded,
    effects: out.effects ?? [],
    ...(out.warningCode !== undefined ? { warningCode: out.warningCode } : {}),
  };
}
