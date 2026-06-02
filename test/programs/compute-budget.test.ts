import { describe, expect, it } from 'vitest';
import { computeBudgetDecoder } from '../../src/decode/programs/compute-budget.js';
import { COMPUTE_BUDGET } from '../helpers.js';
import type { CompiledInstructionView } from '../../src/index.js';

function cbView(data: Uint8Array): CompiledInstructionView {
  return { index: 0, programId: COMPUTE_BUDGET, accounts: [], data };
}

describe('compute-budget decoder', () => {
  it('decodes setComputeUnitLimit', () => {
    const data = new Uint8Array(5);
    const v = new DataView(data.buffer);
    v.setUint8(0, 2);
    v.setUint32(1, 200_000, true);
    const out = computeBudgetDecoder.decode(cbView(data));
    expect(out.type).toBe('setComputeUnitLimit');
    expect(out.args?.['units']).toBe(200_000);
    expect(out.effects?.[0]).toMatchObject({ kind: 'compute-budget', unitLimit: 200_000 });
  });

  it('decodes setComputeUnitPrice and keeps u64 beyond MAX_SAFE_INTEGER as bigint', () => {
    const big = 9_007_199_254_740_993n; // MAX_SAFE_INTEGER + 2
    const data = new Uint8Array(9);
    const v = new DataView(data.buffer);
    v.setUint8(0, 3);
    v.setBigUint64(1, big, true);
    const out = computeBudgetDecoder.decode(cbView(data));
    expect(out.type).toBe('setComputeUnitPrice');
    expect(out.args?.['microLamports']).toBe(big.toString());
    const eff = out.effects?.[0];
    expect(eff && 'unitPriceMicroLamports' in eff ? eff.unitPriceMicroLamports : null).toBe(big);
  });

  it('decodes requestHeapFrame', () => {
    const data = new Uint8Array(5);
    const v = new DataView(data.buffer);
    v.setUint8(0, 1);
    v.setUint32(1, 32 * 1024, true);
    const out = computeBudgetDecoder.decode(cbView(data));
    expect(out.type).toBe('requestHeapFrame');
  });
});
