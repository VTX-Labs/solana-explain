/**
 * SPL Token decoder (single-byte discriminator). Shared by SPL Token and
 * Token-2022, which use the same base instruction layouts.
 *
 * Instruction tags (subset we decode):
 *   0 InitializeMint        1 InitializeAccount     3 Transfer
 *   4 Approve               5 Revoke                6 SetAuthority
 *   7 MintTo                8 Burn                  9 CloseAccount
 *  10 FreezeAccount        11 ThawAccount          12 TransferChecked
 *  13 ApproveChecked       14 MintToChecked        15 BurnChecked
 *  16 InitializeAccount2   17 SyncNative           18 InitializeAccount3
 *  20 InitializeMint2
 */

import type { CompiledInstructionView, DecodeOutput } from '../../types.js';
import { Reader } from '../reader.js';

const MAX_U64 = (1n << 64n) - 1n;

function acc(ix: CompiledInstructionView, i: number): string | undefined {
  return ix.accounts[i]?.pubkey;
}

export type TokenProgramVariant = 'spl-token' | 'token-2022';

/**
 * Decode an SPL-Token-layout instruction. `variant` differentiates the
 * effect's `tokenProgram` and lets Token-2022 flag unparsed extension ixs.
 */
export function decodeTokenInstruction(
  ix: CompiledInstructionView,
  programName: string,
  variant: TokenProgramVariant,
): DecodeOutput {
  if (ix.data.length < 1) {
    return { decoded: false, program: programName, warning: 'empty instruction data' };
  }
  const r = new Reader(ix.data);
  const tag = r.u8('tag');

  try {
    switch (tag) {
      case 0: {
        const decimals = r.u8('decimals');
        return {
          program: programName,
          type: 'initializeMint',
          decoded: true,
          args: { decimals },
          accountNames: ['mint', 'rent'],
        };
      }
      case 20: {
        const decimals = r.u8('decimals');
        return {
          program: programName,
          type: 'initializeMint2',
          decoded: true,
          args: { decimals },
          accountNames: ['mint'],
        };
      }
      case 1:
      case 16:
      case 18: {
        const account = acc(ix, 0) ?? '';
        const mint = acc(ix, 1) ?? '';
        const owner = acc(ix, 2);
        const type =
          tag === 1 ? 'initializeAccount' : tag === 16 ? 'initializeAccount2' : 'initializeAccount3';
        return {
          program: programName,
          type,
          decoded: true,
          accountNames: ['account', 'mint', 'owner'],
          effects: [
            {
              kind: 'account-created',
              address: account,
              owner: owner ?? mint,
              as: 'token-account',
            },
          ],
        };
      }
      case 3: {
        const amount = r.u64('amount');
        const from = acc(ix, 0) ?? '';
        const to = acc(ix, 1) ?? '';
        return {
          program: programName,
          type: 'transfer',
          decoded: true,
          args: { amount: amount.toString() },
          accountNames: ['source', 'destination', 'authority'],
          // No decimals/mint in unchecked transfer — correlate fills from diff.
          effects: [{ kind: 'token-transfer', from, to, amount, tokenProgram: variant }],
          warning: 'unchecked transfer carries no mint/decimals',
          warningCode: 'ambiguous-amount',
        };
      }
      case 12: {
        const amount = r.u64('amount');
        const decimals = r.u8('decimals');
        const source = acc(ix, 0) ?? '';
        const mint = acc(ix, 1) ?? '';
        const dest = acc(ix, 2) ?? '';
        return {
          program: programName,
          type: 'transferChecked',
          decoded: true,
          args: { amount: amount.toString(), decimals },
          accountNames: ['source', 'mint', 'destination', 'authority'],
          effects: [
            { kind: 'token-transfer', from: source, to: dest, mint, amount, decimals, tokenProgram: variant },
          ],
        };
      }
      case 4: {
        const amount = r.u64('amount');
        const delegate = acc(ix, 1) ?? '';
        const owner = acc(ix, 2) ?? '';
        return {
          program: programName,
          type: 'approve',
          decoded: true,
          args: { amount: amount.toString() },
          accountNames: ['source', 'delegate', 'owner'],
          effects: [
            {
              kind: 'approval',
              owner,
              delegate,
              mint: '',
              amount: amount === MAX_U64 ? 'unlimited' : amount,
            },
          ],
        };
      }
      case 13: {
        const amount = r.u64('amount');
        const decimals = r.u8('decimals');
        const mint = acc(ix, 1) ?? '';
        const delegate = acc(ix, 2) ?? '';
        const owner = acc(ix, 3) ?? '';
        return {
          program: programName,
          type: 'approveChecked',
          decoded: true,
          args: { amount: amount.toString(), decimals },
          accountNames: ['source', 'mint', 'delegate', 'owner'],
          effects: [
            {
              kind: 'approval',
              owner,
              delegate,
              mint,
              amount: amount === MAX_U64 ? 'unlimited' : amount,
            },
          ],
        };
      }
      case 5: {
        const owner = acc(ix, 1) ?? '';
        return {
          program: programName,
          type: 'revoke',
          decoded: true,
          accountNames: ['source', 'owner'],
          effects: [{ kind: 'approval', owner, delegate: '', mint: '', amount: 0n, revoke: true }],
        };
      }
      case 6: {
        return {
          program: programName,
          type: 'setAuthority',
          decoded: true,
          accountNames: ['account', 'currentAuthority'],
        };
      }
      case 7: {
        const amount = r.u64('amount');
        const mint = acc(ix, 0) ?? '';
        const to = acc(ix, 1) ?? '';
        return {
          program: programName,
          type: 'mintTo',
          decoded: true,
          args: { amount: amount.toString() },
          accountNames: ['mint', 'destination', 'authority'],
          effects: [{ kind: 'mint', mint, to, amount }],
        };
      }
      case 14: {
        const amount = r.u64('amount');
        const decimals = r.u8('decimals');
        const mint = acc(ix, 0) ?? '';
        const to = acc(ix, 1) ?? '';
        return {
          program: programName,
          type: 'mintToChecked',
          decoded: true,
          args: { amount: amount.toString(), decimals },
          accountNames: ['mint', 'destination', 'authority'],
          effects: [{ kind: 'mint', mint, to, amount, decimals }],
        };
      }
      case 8: {
        const amount = r.u64('amount');
        const from = acc(ix, 0) ?? '';
        const mint = acc(ix, 1) ?? '';
        return {
          program: programName,
          type: 'burn',
          decoded: true,
          args: { amount: amount.toString() },
          accountNames: ['account', 'mint', 'authority'],
          effects: [{ kind: 'burn', mint, from, amount }],
        };
      }
      case 15: {
        const amount = r.u64('amount');
        const decimals = r.u8('decimals');
        const from = acc(ix, 0) ?? '';
        const mint = acc(ix, 1) ?? '';
        return {
          program: programName,
          type: 'burnChecked',
          decoded: true,
          args: { amount: amount.toString(), decimals },
          accountNames: ['account', 'mint', 'authority'],
          effects: [{ kind: 'burn', mint, from, amount, decimals }],
        };
      }
      case 9: {
        const account = acc(ix, 0) ?? '';
        const destination = acc(ix, 1) ?? '';
        return {
          program: programName,
          type: 'closeAccount',
          decoded: true,
          accountNames: ['account', 'destination', 'owner'],
          effects: [{ kind: 'close-account', account, destination }],
        };
      }
      case 10:
        return {
          program: programName,
          type: 'freezeAccount',
          decoded: true,
          accountNames: ['account', 'mint', 'authority'],
        };
      case 11:
        return {
          program: programName,
          type: 'thawAccount',
          decoded: true,
          accountNames: ['account', 'mint', 'authority'],
        };
      case 17: {
        const account = acc(ix, 0) ?? '';
        return {
          program: programName,
          type: 'syncNative',
          decoded: true,
          accountNames: ['account'],
          effects: [{ kind: 'sync-native', account }],
        };
      }
      default:
        return {
          program: programName,
          type: `unknown(${tag})`,
          decoded: false,
          warning: `unrecognized ${programName} instruction tag ${tag}`,
          warningCode: 'partial-decode',
        };
    }
  } catch (err) {
    return {
      program: programName,
      decoded: false,
      warning: err instanceof Error ? err.message : 'token decode failed',
      warningCode: 'partial-decode',
    };
  }
}
