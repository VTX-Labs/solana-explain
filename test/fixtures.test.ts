import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { explainSignature } from '../src/index.js';
import { mockRpc } from './helpers.js';
import type { RawTransactionResponse } from '../src/rpc/types.js';

const here = dirname(fileURLToPath(import.meta.url));

function load(name: string): RawTransactionResponse {
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8')) as RawTransactionResponse;
}

function rpcFor(name: string) {
  const resp = load(name);
  return mockRpc({ getTransaction: () => resp });
}

describe('fixture-driven ExplainResult snapshots', () => {
  it('sol-transfer: success, sol-transfer action, balance deltas', async () => {
    const r = await explainSignature('sig', { rpc: rpcFor('sol-transfer.json') });
    expect(r.success).toBe(true);
    expect(r.actions.some((a) => a.kind === 'sol-transfer')).toBe(true);
    expect(r.balanceChanges.length).toBeGreaterThan(0);
    expect(r.feeLamports).toBe(5000n);
  });

  it('spl-transfer-checked: token-transfer with USDC symbol + decimals', async () => {
    const r = await explainSignature('sig', { rpc: rpcFor('spl-transfer-checked.json') });
    expect(r.success).toBe(true);
    const tt = r.actions.find((a) => a.kind === 'token-transfer');
    expect(tt).toMatchObject({ amount: 250_000_000n, decimals: 6, symbol: 'USDC' });
    const tokDeltas = r.balanceChanges.filter((d) => d.asset.kind === 'token');
    expect(tokDeltas.length).toBe(2);
  });

  it('jupiter-swap: recognized Jupiter v6 program + swap summary', async () => {
    const r = await explainSignature('sig', { rpc: rpcFor('jupiter-swap.json') });
    expect(r.success).toBe(true);
    expect(r.programsInvoked.some((p) => p.name === 'Jupiter v6')).toBe(true);
    expect(r.summary).toMatch(/Jupiter|Swapped|Routed|USDC/);
    // Best-effort warning present (no IDL).
    expect(r.warnings.some((w) => w.code === 'partial-decode' || w.code === 'unknown-program')).toBe(true);
  });

  it('ata-create-idempotent: account-created as ata', async () => {
    const r = await explainSignature('sig', { rpc: rpcFor('ata-create-idempotent.json') });
    expect(r.success).toBe(true);
    expect(r.accountsCreated.some((a) => a.as === 'ata')).toBe(true);
  });

  it('token2022-transfer-fee: base transfer decoded; fee visible in diff', async () => {
    const r = await explainSignature('sig', { rpc: rpcFor('token2022-transfer-fee.json') });
    expect(r.success).toBe(true);
    // Sender lost 1,000,000 base units; receiver gained 990,000 (10k fee).
    const senderDelta = r.balanceChanges.find((d) => d.asset.kind === 'token' && d.delta < 0n);
    const recvDelta = r.balanceChanges.find((d) => d.asset.kind === 'token' && d.delta > 0n);
    expect(senderDelta?.delta).toBe(-1_000_000n);
    expect(recvDelta?.delta).toBe(990_000n);
  });

  it('failed-tx: success:false, decoded error, deltas present, no throw', async () => {
    const r = await explainSignature('sig', { rpc: rpcFor('failed-tx.json') });
    expect(r.success).toBe(false);
    expect(r.error?.human).toMatch(/custom program error 1/i);
    expect(r.balanceChanges.length).toBeGreaterThan(0);
    expect(r.summary).toMatch(/FAILED/);
  });

  it('v0-with-lut: resolves loaded addresses, success', async () => {
    const r = await explainSignature('sig', { rpc: rpcFor('v0-with-lut.json') });
    expect(r.success).toBe(true);
    expect(r.balanceChanges.length).toBeGreaterThan(0);
  });

  it('wsol-wrap-unwrap: syncNative recognized; wSOL delta visible', async () => {
    const r = await explainSignature('sig', { rpc: rpcFor('wsol-wrap-unwrap.json') });
    expect(r.success).toBe(true);
    const wsol = r.balanceChanges.find((d) => d.asset.kind === 'token');
    expect(wsol?.delta).toBe(1_000_000_000n);
    expect(r.instructions.some((i) => i.type === 'syncNative')).toBe(true);
  });
});
