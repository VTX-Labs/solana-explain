/**
 * System program decoder (u32 LE discriminator).
 *
 * Covers: createAccount(0), assign(1), transfer(2), createAccountWithSeed(3),
 * advanceNonce(4), withdrawNonce(5), initializeNonce(6), authorizeNonce(7),
 * allocate(8), allocateWithSeed(9), assignWithSeed(10), transferWithSeed(11).
 */

import type { CompiledInstructionView, DecodeOutput, ProgramDecoder } from '../../types.js';
import { Reader } from '../reader.js';
import { SYSTEM_PROGRAM_ID } from '../known-programs.js';

function acc(ix: CompiledInstructionView, i: number): string | undefined {
  return ix.accounts[i]?.pubkey;
}

function decodeSystem(ix: CompiledInstructionView): DecodeOutput {
  if (ix.data.length < 4) {
    return { decoded: false, program: 'System', warning: 'instruction data too short' };
  }
  const r = new Reader(ix.data);
  const disc = r.u32('discriminator');

  try {
    switch (disc) {
      case 0: {
        // CreateAccount: lamports u64, space u64, owner pubkey
        const lamports = r.u64('lamports');
        const space = r.u64('space');
        const owner = r.pubkey('owner');
        const newAccount = acc(ix, 1) ?? '';
        return {
          program: 'System',
          type: 'createAccount',
          decoded: true,
          args: { lamports: lamports.toString(), space: space.toString(), owner },
          accountNames: ['funding', 'new'],
          effects: [
            {
              kind: 'account-created',
              address: newAccount,
              owner,
              lamports,
              space: Number(space),
              as: 'system',
            },
          ],
        };
      }
      case 1: {
        const owner = r.pubkey('owner');
        return {
          program: 'System',
          type: 'assign',
          decoded: true,
          args: { owner },
          accountNames: ['account'],
        };
      }
      case 2: {
        const lamports = r.u64('lamports');
        const from = acc(ix, 0) ?? '';
        const to = acc(ix, 1) ?? '';
        return {
          program: 'System',
          type: 'transfer',
          decoded: true,
          args: { lamports: lamports.toString() },
          accountNames: ['from', 'to'],
          effects: [{ kind: 'sol-transfer', from, to, lamports }],
        };
      }
      case 3: {
        // CreateAccountWithSeed: base pubkey, seed string, lamports, space, owner
        const base = r.pubkey('base');
        const seedLen = Number(r.u64('seed length'));
        const seed = new TextDecoder().decode(r.bytes_(seedLen, 'seed'));
        const lamports = r.u64('lamports');
        const space = r.u64('space');
        const owner = r.pubkey('owner');
        const newAccount = acc(ix, 1) ?? '';
        return {
          program: 'System',
          type: 'createAccountWithSeed',
          decoded: true,
          args: { base, seed, lamports: lamports.toString(), space: space.toString(), owner },
          accountNames: ['funding', 'new', 'base'],
          effects: [
            {
              kind: 'account-created',
              address: newAccount,
              owner,
              lamports,
              space: Number(space),
              as: 'system',
            },
          ],
        };
      }
      case 8: {
        const space = r.u64('space');
        return {
          program: 'System',
          type: 'allocate',
          decoded: true,
          args: { space: space.toString() },
          accountNames: ['account'],
        };
      }
      case 9: {
        const base = r.pubkey('base');
        const seedLen = Number(r.u64('seed length'));
        const seed = new TextDecoder().decode(r.bytes_(seedLen, 'seed'));
        const space = r.u64('space');
        const owner = r.pubkey('owner');
        return {
          program: 'System',
          type: 'allocateWithSeed',
          decoded: true,
          args: { base, seed, space: space.toString(), owner },
          accountNames: ['account', 'base'],
        };
      }
      case 10: {
        const base = r.pubkey('base');
        const seedLen = Number(r.u64('seed length'));
        const seed = new TextDecoder().decode(r.bytes_(seedLen, 'seed'));
        const owner = r.pubkey('owner');
        return {
          program: 'System',
          type: 'assignWithSeed',
          decoded: true,
          args: { base, seed, owner },
          accountNames: ['account', 'base'],
        };
      }
      case 11: {
        // TransferWithSeed: lamports, fromSeed string, fromOwner pubkey
        const lamports = r.u64('lamports');
        const seedLen = Number(r.u64('seed length'));
        const fromSeed = new TextDecoder().decode(r.bytes_(seedLen, 'fromSeed'));
        const fromOwner = r.pubkey('fromOwner');
        const from = acc(ix, 0) ?? '';
        const to = acc(ix, 2) ?? '';
        return {
          program: 'System',
          type: 'transferWithSeed',
          decoded: true,
          args: { lamports: lamports.toString(), fromSeed, fromOwner },
          accountNames: ['from', 'base', 'to'],
          effects: [{ kind: 'sol-transfer', from, to, lamports }],
        };
      }
      default: {
        const names: Record<number, string> = {
          4: 'advanceNonceAccount',
          5: 'withdrawNonceAccount',
          6: 'initializeNonceAccount',
          7: 'authorizeNonceAccount',
        };
        return {
          program: 'System',
          type: names[disc] ?? `unknown(${disc})`,
          decoded: disc in names,
        };
      }
    }
  } catch (err) {
    return {
      program: 'System',
      decoded: false,
      warning: err instanceof Error ? err.message : 'system decode failed',
      warningCode: 'partial-decode',
    };
  }
}

export const systemDecoder: ProgramDecoder = {
  programId: SYSTEM_PROGRAM_ID,
  name: 'System',
  kind: 'system',
  decode: decodeSystem,
};
