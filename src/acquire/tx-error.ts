/**
 * Map a Solana transaction `err` (from getTransaction meta or simulate value)
 * into human-readable text. Best-effort; covers the common shapes.
 *
 * Examples of `err`:
 *   "AccountInUse"
 *   { InstructionError: [2, { Custom: 6001 }] }
 *   { InstructionError: [0, "InvalidAccountData"] }
 *   { InsufficientFundsForRent: { account_index: 1 } }
 */

import { knownProgram } from '../decode/known-programs.js';
import type { CompiledInstructionView } from '../types.js';

export function humanizeTxError(
  err: unknown,
  instructions?: CompiledInstructionView[],
): { raw: unknown; human: string } {
  return { raw: err, human: describe(err, instructions) };
}

function describe(err: unknown, instructions?: CompiledInstructionView[]): string {
  if (err === null || err === undefined) return 'unknown error';
  if (typeof err === 'string') return prettifyVariant(err);

  if (typeof err === 'object') {
    const entries = Object.entries(err as Record<string, unknown>);
    if (entries.length === 0) return 'unknown error';
    const [key, value] = entries[0]!;

    if (key === 'InstructionError' && Array.isArray(value)) {
      const [idx, detail] = value as [number, unknown];
      const ix = instructions?.[idx];
      const progInfo = ix ? knownProgram(ix.programId) : undefined;
      const where = `instruction #${idx}${progInfo ? ` (${progInfo.name})` : ix ? ` (${ix.programId})` : ''}`;
      if (typeof detail === 'string') {
        return `${where} failed: ${prettifyVariant(detail)}`;
      }
      if (detail && typeof detail === 'object') {
        const dEntries = Object.entries(detail as Record<string, unknown>);
        if (dEntries.length > 0) {
          const [dKey, dVal] = dEntries[0]!;
          if (dKey === 'Custom') {
            return `${where} failed with custom program error ${String(dVal)}`;
          }
          return `${where} failed: ${dKey}${dVal !== null ? ` (${JSON.stringify(dVal)})` : ''}`;
        }
      }
      return `${where} failed`;
    }

    if (key === 'InsufficientFundsForRent') {
      const acc =
        value && typeof value === 'object' && 'account_index' in value
          ? ` (account #${String((value as { account_index: unknown }).account_index)})`
          : '';
      return `insufficient funds for rent${acc}`;
    }

    // Generic single-key object error.
    if (value === null || (typeof value === 'object' && Object.keys(value as object).length === 0)) {
      return prettifyVariant(key);
    }
    return `${prettifyVariant(key)}: ${safeJson(value)}`;
  }

  return String(err);
}

/** "InvalidAccountData" → "invalid account data". */
function prettifyVariant(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
