/**
 * Associated Token Account program decoder.
 *
 * Instructions:
 *   (empty data)  Create           — legacy, no discriminator
 *   0             Create
 *   1             CreateIdempotent
 *   2             RecoverNested
 *
 * Account order for Create/CreateIdempotent:
 *   [payer, ata, owner, mint, systemProgram, tokenProgram, (rent)]
 */

import type { CompiledInstructionView, DecodeOutput, ProgramDecoder } from '../../types.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '../known-programs.js';

function acc(ix: CompiledInstructionView, i: number): string | undefined {
  return ix.accounts[i]?.pubkey;
}

function decodeAta(ix: CompiledInstructionView): DecodeOutput {
  // Legacy "Create" has empty data; modern variants carry a single tag byte.
  const tag = ix.data.length === 0 ? 0 : ix.data[0]!;
  const type =
    tag === 0 ? 'create' : tag === 1 ? 'createIdempotent' : tag === 2 ? 'recoverNested' : undefined;

  if (type === undefined) {
    return {
      program: 'Associated Token Account',
      decoded: false,
      warning: `unrecognized ATA instruction tag ${tag}`,
      warningCode: 'partial-decode',
    };
  }

  if (type === 'recoverNested') {
    return {
      program: 'Associated Token Account',
      type,
      decoded: true,
      accountNames: ['nestedAta', 'nestedMint', 'destinationAta', 'ownerAta', 'ownerMint', 'wallet'],
    };
  }

  const ata = acc(ix, 1) ?? '';
  const owner = acc(ix, 2) ?? '';
  const tokenProgram = acc(ix, 5);
  return {
    program: 'Associated Token Account',
    type,
    decoded: true,
    accountNames: ['payer', 'ata', 'owner', 'mint', 'systemProgram', 'tokenProgram'],
    effects: [
      {
        kind: 'account-created',
        address: ata,
        owner: owner || (tokenProgram ?? ''),
        as: 'ata',
      },
    ],
  };
}

export const ataDecoder: ProgramDecoder = {
  programId: ASSOCIATED_TOKEN_PROGRAM_ID,
  name: 'Associated Token Account',
  kind: 'ata',
  decode: decodeAta,
};
