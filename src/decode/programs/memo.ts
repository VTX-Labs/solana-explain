/**
 * Memo program decoder (v1 + v2). The instruction data IS the UTF-8 memo.
 * Invalid UTF-8 is lossy-decoded with replacement chars; display is truncated
 * at a sane length (full bytes remain available via --raw / args).
 */

import type { CompiledInstructionView, DecodeOutput, ProgramDecoder } from '../../types.js';
import { MEMO_PROGRAM_ID, MEMO_V1_PROGRAM_ID } from '../known-programs.js';

const MAX_DISPLAY = 256;

function decodeMemoData(ix: CompiledInstructionView, name: string): DecodeOutput {
  // `fatal: false` yields replacement chars on invalid UTF-8 (lossy).
  const text = new TextDecoder('utf-8', { fatal: false }).decode(ix.data);
  const display = text.length > MAX_DISPLAY ? `${text.slice(0, MAX_DISPLAY)}…` : text;
  const truncated = text.length > MAX_DISPLAY;
  return {
    program: name,
    type: 'memo',
    decoded: true,
    args: { text: display, ...(truncated ? { truncated: true } : {}) },
    effects: [{ kind: 'memo', text: display }],
    ...(truncated
      ? { warning: 'memo truncated for display; full bytes available via --raw', warningCode: 'partial-decode' as const }
      : {}),
  };
}

export const memoDecoder: ProgramDecoder = {
  programId: MEMO_PROGRAM_ID,
  name: 'Memo',
  kind: 'memo',
  decode: (ix) => decodeMemoData(ix, 'Memo'),
};

export const memoV1Decoder: ProgramDecoder = {
  programId: MEMO_V1_PROGRAM_ID,
  name: 'Memo (v1)',
  kind: 'memo',
  decode: (ix) => decodeMemoData(ix, 'Memo (v1)'),
};
