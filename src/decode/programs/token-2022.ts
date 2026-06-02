/**
 * Token-2022 decoder. Shares the SPL Token base layouts but recognizes the
 * extension-instruction range and flags those it does not byte-decode, rather
 * than failing — the balance diff still reveals the fee impact.
 */

import type { CompiledInstructionView, DecodeOutput, ProgramDecoder } from '../../types.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../known-programs.js';
import { decodeTokenInstruction } from './spl-token.js';

/**
 * Token-2022 instruction tags >= 21 are extension namespaces (TransferFee,
 * ConfidentialTransfer, DefaultAccountState, MemoTransfer, InterestBearing,
 * CpiGuard, TransferHook, MetadataPointer, GroupPointer, etc.). The base
 * layouts (0..20) are identical to SPL Token.
 */
const EXTENSION_TAGS: Record<number, string> = {
  21: 'getAccountDataSize',
  22: 'initializeMintCloseAuthority',
  23: 'transferFeeExtension',
  24: 'confidentialTransferExtension',
  25: 'defaultAccountStateExtension',
  26: 'reallocate',
  27: 'memoTransferExtension',
  28: 'createNativeMint',
  29: 'initializeNonTransferableMint',
  30: 'interestBearingMintExtension',
  31: 'cpiGuardExtension',
  32: 'initializePermanentDelegate',
  33: 'transferHookExtension',
  34: 'confidentialTransferFeeExtension',
  35: 'withdrawExcessLamports',
  36: 'metadataPointerExtension',
  37: 'groupPointerExtension',
  38: 'groupMemberPointerExtension',
};

function decodeToken2022(ix: CompiledInstructionView): DecodeOutput {
  if (ix.data.length < 1) {
    return { decoded: false, program: 'Token-2022', warning: 'empty instruction data' };
  }
  const tag = ix.data[0]!;
  if (tag >= 21) {
    const name = EXTENSION_TAGS[tag] ?? `extension(${tag})`;
    return {
      program: 'Token-2022',
      type: name,
      decoded: false,
      warning: `Token-2022 extension instruction "${name}" not byte-decoded; effect visible in balance diff`,
      warningCode: 'token-2022-extension-unparsed',
    };
  }
  return decodeTokenInstruction(ix, 'Token-2022', 'token-2022');
}

export const token2022Decoder: ProgramDecoder = {
  programId: TOKEN_2022_PROGRAM_ID,
  name: 'Token-2022',
  kind: 'token-2022',
  decode: decodeToken2022,
};

/** The classic SPL Token decoder, sharing the same base layout. */
export const splTokenDecoder: ProgramDecoder = {
  programId: TOKEN_PROGRAM_ID,
  name: 'SPL Token',
  kind: 'token',
  decode: (ix) => decodeTokenInstruction(ix, 'SPL Token', 'spl-token'),
};
