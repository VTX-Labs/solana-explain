/**
 * Pure rendering helpers. No I/O.
 *   - renderText:     sectioned, aligned, optionally colorized
 *   - renderMarkdown: GitHub-flavored markdown (great for issues / PRs)
 *   - renderJson:     BigInt-safe JSON serializer
 *
 * This module is the `@vtx-labs/solana-explain/render` entry point.
 */

import type { Action, BalanceDelta, ExplainResult, RenderOptions } from '../types.js';
import { createStyler, stripAnsi } from './ansi.js';
import {
  formatBlockTime,
  formatCount,
  groupThousands,
  lamportsToSol,
  shortAddr,
} from './format.js';

export { shouldUseColor, stripAnsi, createStyler } from './ansi.js';
export {
  lamportsToSol,
  formatUnits,
  signedUi,
  shortAddr,
  formatBlockTime,
} from './format.js';

const INDENT = '  ';

/** Render the human-readable, optionally colorized report. */
export function renderText(result: ExplainResult, opts: RenderOptions = {}): string {
  const s = createStyler(opts.color ?? false);
  const lines: string[] = [];

  if (opts.quiet) {
    return result.summary;
  }

  // Header line.
  const commitmentNote =
    result.source === 'simulation' ? 'simulation' : (result.commitment ?? 'confirmed');
  const when = formatBlockTime(result.blockTime);
  const headParts = [
    `Solana transaction`,
    commitmentNote,
    result.slot !== undefined ? `slot ${formatCount(result.slot)}` : undefined,
    when,
  ].filter(Boolean);
  lines.push('');
  lines.push(`${INDENT}${s.brand(headParts.join(' · '))}`);

  // Signature + status.
  const status = result.success ? s.green('✓ Success') : s.red('✗ Failed');
  if (result.signature) {
    lines.push(`${INDENT}${s.dim('Signature')}  ${shortAddr(result.signature, 6, 6)}   ${status}`);
  } else {
    lines.push(`${INDENT}${s.dim('Source')}     ${result.source}   ${status}`);
  }
  lines.push('');

  // Summary.
  lines.push(`${INDENT}${s.bold('Summary')}    ${result.summary}`);

  if (!result.success && result.error) {
    lines.push(`${INDENT}${s.red('Error')}      ${result.error.human}`);
  }

  // Balance changes.
  if (result.balanceChanges.length > 0) {
    lines.push('');
    lines.push(`${INDENT}${s.bold('Balance changes')}`);
    for (const d of groupBalances(result.balanceChanges, result.feePayer)) {
      const label = d.label;
      const focusTag =
        d.account === result.feePayer ? s.dim(' (fee payer)') : '';
      const colored = colorDelta(d.text, s);
      lines.push(`${INDENT}${INDENT}${padRight(label, 22)}${colored}${focusTag}`);
    }
  }

  // Actions.
  if (result.actions.length > 0) {
    lines.push('');
    lines.push(`${INDENT}${s.bold('Actions')}`);
    result.actions.forEach((a, i) => {
      lines.push(`${INDENT}${INDENT}${i + 1}. ${describeAction(a)}`);
    });
  }

  // Verbose: instruction tree.
  if (opts.verbose && result.instructions.length > 0) {
    lines.push('');
    lines.push(`${INDENT}${s.bold('Instructions')}`);
    for (const ix of result.instructions) {
      renderInstruction(ix, lines, s, 2);
    }
  }

  // Programs.
  if (result.programsInvoked.length > 0) {
    const names = result.programsInvoked
      .map((p) => p.name ?? shortAddr(p.programId))
      .filter((v, idx, arr) => arr.indexOf(v) === idx);
    lines.push('');
    lines.push(`${INDENT}${s.bold('Programs')}   ${names.join(' · ')}`);
  }

  // Fee + compute.
  const feeStr = `${lamportsToSol(result.feeLamports)} SOL`;
  const computeStr =
    result.computeUnits !== undefined ? `${formatCount(result.computeUnits)} units` : 'n/a';
  lines.push(`${INDENT}${s.bold('Fee')}        ${feeStr}${' '.repeat(8)}${s.bold('Compute')}   ${computeStr}`);

  // Warnings.
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push(`${INDENT}${s.yellow(`⚠ ${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''}`)}`);
    for (const w of result.warnings) {
      const at = w.instructionIndex !== undefined ? ` [ix #${w.instructionIndex}]` : '';
      lines.push(`${INDENT}${INDENT}${s.dim('·')} ${w.message}${s.dim(at)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function renderInstruction(
  ix: ExplainResult['instructions'][number],
  lines: string[],
  s: ReturnType<typeof createStyler>,
  depth: number,
): void {
  const pad = INDENT.repeat(depth);
  const name = ix.program ?? shortAddr(ix.programId);
  const type = ix.type ? `.${ix.type}` : '';
  const mark = ix.decoded ? '' : s.dim(' (not decoded)');
  lines.push(`${pad}${s.cyan(`#${ix.index}`)} ${name}${type}${mark}`);
  if (ix.args && Object.keys(ix.args).length > 0) {
    const argStr = Object.entries(ix.args)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(', ');
    lines.push(`${pad}${INDENT}${s.dim(argStr)}`);
  }
  if (ix.inner) {
    for (const inner of ix.inner) renderInstruction(inner, lines, s, depth + 1);
  }
}

interface GroupedBalance {
  account: string;
  label: string;
  text: string;
}

function groupBalances(deltas: BalanceDelta[], feePayer: string): GroupedBalance[] {
  // Group by account; combine SOL + token deltas onto one line per account.
  const byAccount = new Map<string, BalanceDelta[]>();
  for (const d of deltas) {
    const list = byAccount.get(d.account) ?? [];
    list.push(d);
    byAccount.set(d.account, list);
  }
  const out: GroupedBalance[] = [];
  for (const [account, list] of byAccount) {
    const text = list.map((d) => d.uiDelta).join('   ');
    const isFee = account === feePayer;
    out.push({ account, label: shortAddr(account, 4, 4) + (isFee ? '' : ''), text });
  }
  return out;
}

function colorDelta(text: string, s: ReturnType<typeof createStyler>): string {
  return text
    .split('   ')
    .map((part) =>
      part.trim().startsWith('-') ? s.red(part) : part.trim().startsWith('+') ? s.green(part) : part,
    )
    .join('   ');
}

function padRight(str: string, width: number): string {
  const visible = stripAnsi(str);
  return visible.length >= width ? str : str + ' '.repeat(width - visible.length);
}

/** Human one-liner for an action. */
export function describeAction(a: Action): string {
  switch (a.kind) {
    case 'sol-transfer':
      return `Transfer ${a.sol} SOL  ${shortAddr(a.from)} → ${shortAddr(a.to)}`;
    case 'token-transfer': {
      const sym = a.symbol ?? shortAddr(a.mint);
      const self = a.from === a.to ? '  (self-transfer)' : '';
      return `Transfer ${a.uiAmount} ${sym}  ${shortAddr(a.from)} → ${shortAddr(a.to)}${self}`;
    }
    case 'mint':
      return `Mint ${a.uiAmount} of ${shortAddr(a.mint)} → ${shortAddr(a.to)}`;
    case 'burn':
      return `Burn ${a.uiAmount} of ${shortAddr(a.mint)} from ${shortAddr(a.from)}`;
    case 'account-created': {
      const as = a.as ? ` (${a.as})` : '';
      return `Create account ${shortAddr(a.address)}${as} owned by ${shortAddr(a.owner)}`;
    }
    case 'approval':
      if (a.revoke) return `Revoke delegate on ${shortAddr(a.owner)}`;
      return `Approve ${a.amount === 'unlimited' ? 'unlimited' : a.amount.toString()} to delegate ${shortAddr(a.delegate)}`;
    case 'close-account':
      return `Close account ${shortAddr(a.account)} → reclaim ${lamportsToSol(a.reclaimedLamports)} SOL to ${shortAddr(a.destination)}`;
    case 'memo':
      return `Memo: "${a.text}"`;
    case 'compute-budget': {
      const parts: string[] = [];
      if (a.unitLimit !== undefined) parts.push(`unit limit ${groupThousands(a.unitLimit.toString())}`);
      if (a.unitPriceMicroLamports !== undefined)
        parts.push(`price ${a.unitPriceMicroLamports.toString()} µ-lamports`);
      return `Set compute budget: ${parts.join(', ') || '(no-op)'}`;
    }
    case 'program-call': {
      const name = a.program ?? shortAddr(a.programId);
      const note = a.note ? `  — ${a.note}` : '';
      return `Call ${name}${a.instruction ? `.${a.instruction}` : ''}${note}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function renderMarkdown(result: ExplainResult): string {
  const lines: string[] = [];
  lines.push(`### Solana transaction — ${result.success ? '✅ Success' : '❌ Failed'}`);
  lines.push('');
  if (result.signature) lines.push(`**Signature:** \`${result.signature}\`  `);
  if (result.slot !== undefined) lines.push(`**Slot:** ${formatCount(result.slot)}  `);
  const when = formatBlockTime(result.blockTime);
  if (when) lines.push(`**Time:** ${when}  `);
  lines.push(`**Fee:** ${lamportsToSol(result.feeLamports)} SOL  `);
  if (result.computeUnits !== undefined)
    lines.push(`**Compute:** ${formatCount(result.computeUnits)} units  `);
  lines.push('');
  lines.push(`> ${result.summary}`);
  lines.push('');

  if (!result.success && result.error) {
    lines.push(`**Error:** ${result.error.human}`);
    lines.push('');
  }

  if (result.balanceChanges.length > 0) {
    lines.push('#### Balance changes');
    lines.push('');
    lines.push('| Account | Asset | Change |');
    lines.push('| --- | --- | --- |');
    for (const d of result.balanceChanges) {
      const asset =
        d.asset.kind === 'SOL'
          ? 'SOL'
          : `${d.asset.symbol ?? shortAddr(d.asset.mint)}`;
      lines.push(`| \`${shortAddr(d.account, 6, 6)}\` | ${asset} | ${d.uiDelta} |`);
    }
    lines.push('');
  }

  if (result.actions.length > 0) {
    lines.push('#### Actions');
    lines.push('');
    result.actions.forEach((a, i) => lines.push(`${i + 1}. ${describeAction(a)}`));
    lines.push('');
  }

  if (result.programsInvoked.length > 0) {
    lines.push('#### Programs');
    lines.push('');
    for (const p of result.programsInvoked) {
      lines.push(`- ${p.name ?? `\`${p.programId}\``} ×${p.count}`);
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push('#### Warnings');
    lines.push('');
    for (const w of result.warnings) lines.push(`- ⚠️ ${w.message} \`(${w.code})\``);
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// JSON (BigInt-safe)
// ---------------------------------------------------------------------------

/** Serialize an ExplainResult to JSON; BigInts become decimal strings. */
export function renderJson(result: ExplainResult, opts?: { pretty?: boolean }): string {
  const replacer = (_key: string, value: unknown): unknown =>
    typeof value === 'bigint' ? value.toString() : value;
  return JSON.stringify(result, replacer, opts?.pretty ? 2 : undefined);
}
