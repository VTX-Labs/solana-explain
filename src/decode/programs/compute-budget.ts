/**
 * Compute Budget program decoder (single-byte discriminator).
 *
 *   0 RequestUnits (deprecated)
 *   1 RequestHeapFrame   (u32 bytes)
 *   2 SetComputeUnitLimit (u32 units)
 *   3 SetComputeUnitPrice (u64 micro-lamports per CU — kept as bigint)
 *   4 SetLoadedAccountsDataSizeLimit (u32 bytes)
 */

import type { CompiledInstructionView, DecodeOutput, ProgramDecoder } from '../../types.js';
import { Reader } from '../reader.js';
import { COMPUTE_BUDGET_PROGRAM_ID } from '../known-programs.js';

function decodeComputeBudget(ix: CompiledInstructionView): DecodeOutput {
  if (ix.data.length < 1) {
    return { decoded: false, program: 'Compute Budget', warning: 'empty instruction data' };
  }
  const r = new Reader(ix.data);
  const tag = r.u8('tag');

  try {
    switch (tag) {
      case 1: {
        const bytes = r.u32('heap bytes');
        return {
          program: 'Compute Budget',
          type: 'requestHeapFrame',
          decoded: true,
          args: { bytes },
        };
      }
      case 2: {
        const units = r.u32('unit limit');
        return {
          program: 'Compute Budget',
          type: 'setComputeUnitLimit',
          decoded: true,
          args: { units },
          effects: [{ kind: 'compute-budget', unitLimit: units }],
        };
      }
      case 3: {
        const price = r.u64('micro-lamports');
        return {
          program: 'Compute Budget',
          type: 'setComputeUnitPrice',
          decoded: true,
          args: { microLamports: price.toString() },
          effects: [{ kind: 'compute-budget', unitPriceMicroLamports: price }],
        };
      }
      case 4: {
        const bytes = r.u32('data size limit');
        return {
          program: 'Compute Budget',
          type: 'setLoadedAccountsDataSizeLimit',
          decoded: true,
          args: { bytes },
        };
      }
      case 0:
        return {
          program: 'Compute Budget',
          type: 'requestUnits',
          decoded: true,
        };
      default:
        return {
          program: 'Compute Budget',
          type: `unknown(${tag})`,
          decoded: false,
          warningCode: 'partial-decode',
        };
    }
  } catch (err) {
    return {
      program: 'Compute Budget',
      decoded: false,
      warning: err instanceof Error ? err.message : 'compute-budget decode failed',
      warningCode: 'partial-decode',
    };
  }
}

export const computeBudgetDecoder: ProgramDecoder = {
  programId: COMPUTE_BUDGET_PROGRAM_ID,
  name: 'Compute Budget',
  kind: 'compute-budget',
  decode: decodeComputeBudget,
};
