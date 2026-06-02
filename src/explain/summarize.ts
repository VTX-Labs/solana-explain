/**
 * `summarize`: one-line plain-English headline using priority heuristics:
 *   swap > transfer > mint/burn > approval > account-creation > program-call.
 * Always phrased from `focusAccount` when given (else the fee payer).
 */

import type { Action, BalanceDelta, ProgramInvocation } from '../types.js';
import { formatUnits, lamportsToSol, shortAddr } from '../render/format.js';
import { netSolByAccount, netTokenByOwnerMint } from './diff.js';

export interface SummarizeInput {
  actions: Action[];
  deltas: BalanceDelta[];
  programsInvoked: ProgramInvocation[];
  feePayer: string;
  feeLamports: bigint;
  success: boolean;
  error?: { human: string };
  focusAccount?: string;
}

function aggregatorName(programs: ProgramInvocation[]): string | undefined {
  // Prefer an aggregator (Jupiter) over a raw AMM for the headline.
  const agg = programs.find((p) => p.name && isAggregator(p.name));
  if (agg?.name) return agg.name;
  const amm = programs.find((p) => p.name && isAmm(p.name));
  return amm?.name;
}

function isAggregator(name: string): boolean {
  return /jupiter/i.test(name);
}
function isAmm(name: string): boolean {
  return /raydium|orca|whirlpool|phoenix|meteora/i.test(name);
}

export function summarize(input: SummarizeInput): string {
  const { actions, deltas, programsInvoked, feePayer, feeLamports, success, error, focusAccount } =
    input;
  const focus = focusAccount ?? feePayer;
  const feeSol = lamportsToSol(feeLamports);
  const feeSuffix = feeLamports > 0n ? `, paid ${feeSol} SOL fee` : '';

  if (!success) {
    const why = error?.human ? `: ${error.human}` : '';
    return `Transaction FAILED${why}. ${feeLamports > 0n ? `Fee of ${feeSol} SOL was still charged.` : ''}`.trim();
  }

  const solByAcc = netSolByAccount(deltas);
  const tokByOwner = netTokenByOwnerMint(deltas);

  // "Meaningful" deltas exclude a delta that is ONLY the fee on the fee payer,
  // so a memo/compute-only tx (whose only balance change is the fee) is
  // narrated as such rather than as an opaque "balance changed".
  const meaningfulDeltas = deltas.filter((d) => {
    if (d.asset.kind === 'token') return true;
    if (d.account !== feePayer) return true;
    return d.delta !== -feeLamports;
  });

  // ---- Swap detection: a DEX/aggregator program + focus account has one ----
  // token going out and another coming in (or SOL ↔ token).
  const hasDex = programsInvoked.some((p) => p.name && (isAggregator(p.name) || isAmm(p.name)));
  if (hasDex) {
    const dexName = aggregatorName(programsInvoked) ?? 'a DEX';
    const focusGains: string[] = [];
    const focusLosses: string[] = [];
    // SOL movement on focus (excluding fee — fee already separate-ish; we just
    // describe magnitude).
    const solDelta = solByAcc.get(focus);
    if (solDelta !== undefined && solDelta !== 0n) {
      const label = `${formatUnits(absBig(solDelta), 9)} SOL`;
      (solDelta > 0n ? focusGains : focusLosses).push(label);
    }
    for (const t of tokByOwner.values()) {
      if (t.owner !== focus || t.delta === 0n) continue;
      const label = `${formatUnits(absBig(t.delta), t.decimals)} ${t.symbol ?? shortAddr(t.mint)}`;
      (t.delta > 0n ? focusGains : focusLosses).push(label);
    }
    if (focusLosses.length > 0 && focusGains.length > 0) {
      return `Swapped ${focusLosses.join(' + ')} for ${focusGains.join(' + ')} via ${dexName}${feeSuffix}.`;
    }
    if (focusGains.length > 0 || focusLosses.length > 0) {
      const moved = [...focusGains, ...focusLosses].join(', ');
      return `Routed ${moved} via ${dexName}${feeSuffix}.`;
    }
  }

  // ---- Transfer: prefer the largest concrete transfer action ----
  const tokenTransfers = actions.filter((a) => a.kind === 'token-transfer');
  const solTransfers = actions.filter((a) => a.kind === 'sol-transfer');

  if (tokenTransfers.length > 0) {
    const biggest = tokenTransfers
      .slice()
      .sort((a, b) => (a.amount > b.amount ? -1 : 1))[0]!;
    const sym = biggest.symbol ?? shortAddr(biggest.mint);
    const dirNote =
      biggest.from === biggest.to ? ' (self-transfer, no net movement)' : '';
    const count =
      tokenTransfers.length > 1 ? ` (+${tokenTransfers.length - 1} more transfer${tokenTransfers.length - 1 > 1 ? 's' : ''})` : '';
    return `Transferred ${biggest.uiAmount} ${sym} from ${shortAddr(biggest.from)} to ${shortAddr(biggest.to)}${dirNote}${count}${feeSuffix}.`;
  }

  if (solTransfers.length > 0) {
    const total = solTransfers.reduce((acc, a) => acc + a.lamports, 0n);
    if (solTransfers.length === 1) {
      const a = solTransfers[0]!;
      return `Sent ${a.sol} SOL from ${shortAddr(a.from)} to ${shortAddr(a.to)}${feeSuffix}.`;
    }
    return `Made ${solTransfers.length} SOL transfers totaling ${lamportsToSol(total)} SOL${feeSuffix}.`;
  }

  // ---- Mint / burn ----
  const mints = actions.filter((a) => a.kind === 'mint');
  const burns = actions.filter((a) => a.kind === 'burn');
  if (mints.length > 0) {
    const m = mints[0]!;
    return `Minted ${m.uiAmount} of ${shortAddr(m.mint)} to ${shortAddr(m.to)}${feeSuffix}.`;
  }
  if (burns.length > 0) {
    const b = burns[0]!;
    return `Burned ${b.uiAmount} of ${shortAddr(b.mint)}${feeSuffix}.`;
  }

  // ---- Approvals ----
  const approvals = actions.filter((a) => a.kind === 'approval');
  if (approvals.length > 0) {
    const ap = approvals[0]!;
    if (ap.revoke) {
      return `Revoked token delegate approval${feeSuffix}.`;
    }
    const amt = ap.amount === 'unlimited' ? 'unlimited' : ap.amount.toString();
    return `Approved delegate ${shortAddr(ap.delegate)} to spend ${amt} tokens${feeSuffix}.`;
  }

  // ---- Account creation ----
  const created = actions.filter((a) => a.kind === 'account-created');
  if (created.length > 0) {
    const what = created.some((c) => c.kind === 'account-created' && c.as === 'ata')
      ? 'associated token account'
      : 'account';
    const plural = created.length > 1 ? `${created.length} accounts` : `an ${what}`;
    return `Created ${plural}${feeSuffix}.`;
  }

  // ---- Compute / memo only ----
  const memos = actions.filter((a) => a.kind === 'memo');
  const cb = actions.filter((a) => a.kind === 'compute-budget');
  if (memos.length > 0 && meaningfulDeltas.length === 0) {
    const text = memos[0]!.kind === 'memo' ? memos[0]!.text : '';
    const memoNote = `attached memo "${text}"`;
    return cb.length > 0 ? `Set compute budget; ${memoNote}${feeSuffix}.` : `${capitalize(memoNote)}${feeSuffix}.`;
  }
  if (
    cb.length > 0 &&
    meaningfulDeltas.length === 0 &&
    actions.every((a) => a.kind === 'compute-budget')
  ) {
    return `Set compute budget only; no balance changes${feeSuffix}.`;
  }

  // ---- Program-call fallback ----
  const calls = actions.filter((a) => a.kind === 'program-call');
  if (calls.length > 0) {
    const named = calls.find((c) => c.kind === 'program-call' && c.program);
    const name =
      named && named.kind === 'program-call' && named.program
        ? named.program
        : shortAddr(calls[0]!.kind === 'program-call' ? calls[0]!.programId : '');
    if (deltas.length > 0) {
      return `Interacted with ${name}; see balance changes for the net effect${feeSuffix}.`;
    }
    return `Called ${name} (no net balance change)${feeSuffix}.`;
  }

  // ---- Last resort ----
  if (meaningfulDeltas.length > 0) {
    return `Transaction changed ${meaningfulDeltas.length} balance${meaningfulDeltas.length > 1 ? 's' : ''}${feeSuffix}.`;
  }
  return `Transaction succeeded with no net balance change${feeSuffix}.`;
}

function absBig(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
