/**
 * `diffBalances`: pure diff of pre/post lamport + token balances into typed
 * {@link BalanceDelta}[]. No I/O.
 *
 * - SOL deltas: by account key index (post − pre).
 * - Token deltas: keyed by token-account address + mint, matching pre/post.
 *   Accounts present on only one side are created (post-only) or closed
 *   (pre-only).
 */

import type { BalanceDelta, BalanceSnapshot, TokenBalanceEntry } from '../types.js';
import { lamportsToSol, signedUi } from '../render/format.js';

function tokenKey(e: { account: string; mint: string }): string {
  return `${e.account}::${e.mint}`;
}

export function diffBalances(pre: BalanceSnapshot, post: BalanceSnapshot): BalanceDelta[] {
  const deltas: BalanceDelta[] = [];

  // ---- SOL deltas, matched by account address (robust to index drift) ----
  const preLamportsByAddr = new Map<string, bigint>();
  for (let i = 0; i < pre.accountKeys.length; i++) {
    const key = pre.accountKeys[i];
    const lam = pre.lamports[i];
    if (key !== undefined && lam !== undefined) preLamportsByAddr.set(key, lam);
  }
  const seenAddrs = new Set<string>();
  for (let i = 0; i < post.accountKeys.length; i++) {
    const account = post.accountKeys[i];
    const postLam = post.lamports[i];
    if (account === undefined || postLam === undefined) continue;
    seenAddrs.add(account);
    const preLam = preLamportsByAddr.get(account) ?? 0n;
    const delta = postLam - preLam;
    if (delta !== 0n) {
      deltas.push({
        account,
        asset: { kind: 'SOL' },
        pre: preLam,
        post: postLam,
        delta,
        uiDelta: signedUi(delta, 9, 'SOL'),
      });
    }
  }
  // Accounts that vanished (closed) — present in pre only.
  for (const [account, preLam] of preLamportsByAddr) {
    if (seenAddrs.has(account)) continue;
    const delta = 0n - preLam;
    if (delta !== 0n) {
      deltas.push({
        account,
        asset: { kind: 'SOL' },
        pre: preLam,
        post: 0n,
        delta,
        uiDelta: signedUi(delta, 9, 'SOL'),
      });
    }
  }

  // ---- Token deltas, keyed by token-account + mint ----
  const preTok = new Map<string, TokenBalanceEntry>();
  for (const e of pre.tokenBalances) preTok.set(tokenKey(e), e);
  const postTok = new Map<string, TokenBalanceEntry>();
  for (const e of post.tokenBalances) postTok.set(tokenKey(e), e);

  const allKeys = new Set<string>([...preTok.keys(), ...postTok.keys()]);
  for (const key of allKeys) {
    const p = preTok.get(key);
    const q = postTok.get(key);
    const meta = q ?? p;
    if (!meta) continue;
    const preAmt = p?.amount ?? 0n;
    const postAmt = q?.amount ?? 0n;
    const delta = postAmt - preAmt;
    if (delta === 0n) continue;
    const decimals = meta.decimals;
    deltas.push({
      account: meta.account,
      asset: {
        kind: 'token',
        mint: meta.mint,
        decimals,
        ...(meta.symbol !== undefined ? { symbol: meta.symbol } : {}),
        tokenProgram: meta.tokenProgram,
      },
      pre: preAmt,
      post: postAmt,
      delta,
      uiDelta: signedUi(delta, decimals, meta.symbol),
      ...(meta.owner !== undefined ? { owner: meta.owner } : {}),
    });
  }

  // Stable-ish ordering: SOL first, then tokens, by descending |delta|.
  deltas.sort((a, b) => {
    if (a.asset.kind !== b.asset.kind) return a.asset.kind === 'SOL' ? -1 : 1;
    const am = a.delta < 0n ? -a.delta : a.delta;
    const bm = b.delta < 0n ? -b.delta : b.delta;
    return am > bm ? -1 : am < bm ? 1 : 0;
  });

  return deltas;
}

/** Sum SOL deltas grouped by account for summary phrasing. */
export function netSolByAccount(deltas: BalanceDelta[]): Map<string, bigint> {
  const m = new Map<string, bigint>();
  for (const d of deltas) {
    if (d.asset.kind === 'SOL') m.set(d.account, (m.get(d.account) ?? 0n) + d.delta);
  }
  return m;
}

/** Group token deltas by owner+mint to show net per-owner movement. */
export function netTokenByOwnerMint(
  deltas: BalanceDelta[],
): Map<string, { owner: string; mint: string; decimals: number; symbol?: string; delta: bigint }> {
  const m = new Map<
    string,
    { owner: string; mint: string; decimals: number; symbol?: string; delta: bigint }
  >();
  for (const d of deltas) {
    if (d.asset.kind !== 'token') continue;
    const owner = d.owner ?? d.account;
    const key = `${owner}::${d.asset.mint}`;
    const cur = m.get(key);
    if (cur) {
      cur.delta += d.delta;
    } else {
      m.set(key, {
        owner,
        mint: d.asset.mint,
        decimals: d.asset.decimals,
        ...(d.asset.symbol !== undefined ? { symbol: d.asset.symbol } : {}),
        delta: d.delta,
      });
    }
  }
  return m;
}

export { lamportsToSol };
