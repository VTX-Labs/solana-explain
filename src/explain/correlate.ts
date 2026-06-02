/**
 * `correlate`: fuse decoded instructions with balance deltas into a
 * high-confidence, ordered {@link Action}[]. Pure, no I/O.
 *
 * Philosophy: the *truth* of "what changed" is the balance diff; instruction
 * decoding adds names and intent. When decoding is impossible we degrade to
 * diff-derived narrative, never to nothing.
 */

import type {
  Action,
  AccountCreation,
  Approval,
  BalanceDelta,
  CompiledInstructionView,
  DecodedInstruction,
  DecoderEffect,
  ProgramInvocation,
  ProgramRegistry,
  TokenBalanceEntry,
  Warning,
} from '../types.js';
import { decodeInstructionRaw } from '../decode/registry.js';
import { knownProgram } from '../decode/known-programs.js';
import { formatUnits, lamportsToSol } from '../render/format.js';
import { isWsol, resolveSymbol } from './token-meta.js';

export interface CorrelateInput {
  instructions: CompiledInstructionView[];
  innerInstructions?: { index: number; instructions: CompiledInstructionView[] }[];
  deltas: BalanceDelta[];
  tokenBalances: TokenBalanceEntry[];
  registry: ProgramRegistry;
}

export interface CorrelateOutput {
  decoded: DecodedInstruction[];
  actions: Action[];
  accountsCreated: AccountCreation[];
  approvals: Approval[];
  programsInvoked: ProgramInvocation[];
  warnings: Warning[];
}

/** Build a mint→decimals lookup from token balances + decoder effects. */
function mintDecimals(tokenBalances: TokenBalanceEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const tb of tokenBalances) {
    if (!m.has(tb.mint)) m.set(tb.mint, tb.decimals);
  }
  return m;
}

/** Token account → {mint, owner, decimals, tokenProgram} from balances. */
function tokenAccountMeta(
  tokenBalances: TokenBalanceEntry[],
): Map<string, { mint: string; owner?: string; decimals: number; tokenProgram: string }> {
  const m = new Map<
    string,
    { mint: string; owner?: string; decimals: number; tokenProgram: string }
  >();
  for (const tb of tokenBalances) {
    m.set(tb.account, {
      mint: tb.mint,
      ...(tb.owner !== undefined ? { owner: tb.owner } : {}),
      decimals: tb.decimals,
      tokenProgram: tb.tokenProgram,
    });
  }
  return m;
}

function uiAmount(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}

export function correlate(input: CorrelateInput): CorrelateOutput {
  const { instructions, innerInstructions, deltas, tokenBalances, registry } = input;
  const decoded: DecodedInstruction[] = [];
  const actions: Action[] = [];
  const accountsCreated: AccountCreation[] = [];
  const approvals: Approval[] = [];
  const warnings: Warning[] = [];
  const invocationCounts = new Map<string, number>();

  const decByMint = mintDecimals(tokenBalances);
  const taMeta = tokenAccountMeta(tokenBalances);
  const innerByIndex = new Map<number, CompiledInstructionView[]>();
  for (const grp of innerInstructions ?? []) innerByIndex.set(grp.index, grp.instructions);

  const seenSyncNative = new Set<string>();

  const handleEffect = (eff: DecoderEffect): void => {
    switch (eff.kind) {
      case 'sol-transfer': {
        actions.push({
          kind: 'sol-transfer',
          from: eff.from,
          to: eff.to,
          lamports: eff.lamports,
          sol: lamportsToSol(eff.lamports),
        });
        break;
      }
      case 'token-transfer': {
        // Resolve mint/decimals from the source/dest token-account state.
        const srcMeta = taMeta.get(eff.from);
        const dstMeta = taMeta.get(eff.to);
        const mint = eff.mint || srcMeta?.mint || dstMeta?.mint || '';
        const decimals =
          eff.decimals ?? srcMeta?.decimals ?? dstMeta?.decimals ?? decByMint.get(mint);
        const symbol = mint ? resolveSymbol(mint) : undefined;
        if (decimals === undefined) {
          warnings.push({
            code: 'ambiguous-amount',
            message: `token transfer of ${eff.amount} raw units lacks decimals; shown in base units`,
          });
        }
        const dec = decimals ?? 0;
        const action: Action = {
          kind: 'token-transfer',
          from: eff.from,
          to: eff.to,
          mint,
          amount: eff.amount,
          uiAmount: uiAmount(eff.amount, dec),
          decimals: dec,
          tokenProgram: eff.tokenProgram,
          ...(symbol !== undefined ? { symbol } : {}),
        };
        actions.push(action);
        break;
      }
      case 'mint': {
        const decimals = eff.decimals ?? decByMint.get(eff.mint) ?? 0;
        actions.push({
          kind: 'mint',
          mint: eff.mint,
          to: eff.to,
          amount: eff.amount,
          uiAmount: uiAmount(eff.amount, decimals),
        });
        break;
      }
      case 'burn': {
        const decimals = eff.decimals ?? decByMint.get(eff.mint) ?? 0;
        actions.push({
          kind: 'burn',
          mint: eff.mint,
          from: eff.from,
          amount: eff.amount,
          uiAmount: uiAmount(eff.amount, decimals),
        });
        break;
      }
      case 'approval': {
        const mint = eff.mint || taMeta.get(eff.owner)?.mint || '';
        const ap: Approval = {
          owner: eff.owner,
          delegate: eff.delegate,
          mint,
          amount: eff.amount,
          ...(eff.revoke !== undefined ? { revoke: eff.revoke } : {}),
        };
        approvals.push(ap);
        actions.push({ kind: 'approval', ...ap });
        break;
      }
      case 'close-account': {
        // Reclaimed lamports = the negative SOL delta on the closed account.
        const d = deltas.find((x) => x.account === eff.account && x.asset.kind === 'SOL');
        const reclaimed = d ? -d.delta : 0n;
        actions.push({
          kind: 'close-account',
          account: eff.account,
          destination: eff.destination,
          reclaimedLamports: reclaimed > 0n ? reclaimed : 0n,
        });
        break;
      }
      case 'account-created': {
        const meta = taMeta.get(eff.address);
        const ac: AccountCreation = {
          address: eff.address,
          owner: eff.owner,
          lamports: eff.lamports ?? 0n,
          ...(eff.space !== undefined ? { space: eff.space } : {}),
          ...(eff.as !== undefined ? { as: eff.as } : meta ? { as: 'token-account' as const } : {}),
        };
        accountsCreated.push(ac);
        actions.push({ kind: 'account-created', ...ac });
        break;
      }
      case 'memo': {
        actions.push({ kind: 'memo', text: eff.text });
        break;
      }
      case 'compute-budget': {
        actions.push({
          kind: 'compute-budget',
          ...(eff.unitLimit !== undefined ? { unitLimit: eff.unitLimit } : {}),
          ...(eff.unitPriceMicroLamports !== undefined
            ? { unitPriceMicroLamports: eff.unitPriceMicroLamports }
            : {}),
        });
        break;
      }
      case 'sync-native': {
        seenSyncNative.add(eff.account);
        break;
      }
    }
  };

  // Decode a flat list of inner (CPI) instructions. Solana's getTransaction /
  // simulate returns innerInstructions as a flat array per top-level index, so
  // there is no nesting to recurse — we decode each child once.
  const decodeInner = (views: CompiledInstructionView[]): DecodedInstruction[] =>
    views.map((view) => {
      invocationCounts.set(view.programId, (invocationCounts.get(view.programId) ?? 0) + 1);
      const { decoded: dec, effects, warningCode } = decodeInstructionRaw(view, registry);
      if (!dec.decoded) {
        const known = knownProgram(view.programId);
        warnings.push({
          code: known ? 'partial-decode' : 'unknown-program',
          message: dec.warning ?? (known ? `${known.name} not byte-decoded` : 'unknown program'),
          instructionIndex: view.index,
        });
      } else if (warningCode) {
        warnings.push({
          code: warningCode,
          message: dec.warning ?? 'partial decode',
          instructionIndex: view.index,
        });
      }
      for (const eff of effects) handleEffect(eff);
      return dec;
    });

  // Top-level instructions (+ their inner CPI children).
  for (const view of instructions) {
    invocationCounts.set(view.programId, (invocationCounts.get(view.programId) ?? 0) + 1);
    const { decoded: dec, effects, warningCode } = decodeInstructionRaw(view, registry);

    if (!dec.decoded) {
      const known = knownProgram(view.programId);
      warnings.push({
        code: known ? 'partial-decode' : 'unknown-program',
        message: dec.warning ?? (known ? `${known.name} not byte-decoded` : 'unknown program'),
        instructionIndex: view.index,
      });
      // Best-effort: emit a program-call action so the instruction isn't silent.
      actions.push({
        kind: 'program-call',
        programId: view.programId,
        ...(known ? { program: known.name } : {}),
        ...(known
          ? { note: 'effect inferred from balance diff (no IDL)' }
          : { note: 'unknown program; see balance changes' }),
      });
    } else if (warningCode) {
      warnings.push({
        code: warningCode,
        message: dec.warning ?? 'partial decode',
        instructionIndex: view.index,
      });
    }

    for (const eff of effects) handleEffect(eff);

    const inner = innerByIndex.get(view.index);
    if (inner && inner.length > 0) {
      dec.inner = decodeInner(inner);
    }

    decoded.push(dec);
  }

  // wSOL recognition: if a sync-native happened on an account whose mint is
  // wSOL, annotate any token-transfer on that account as SOL↔wSOL.
  if (seenSyncNative.size > 0) {
    for (const action of actions) {
      if (action.kind === 'token-transfer' && isWsol(action.mint)) {
        // Leave the token-transfer but ensure symbol reads wSOL.
        if (!action.symbol) action.symbol = 'wSOL';
      }
    }
  }

  // Account created AND closed within the same tx (e.g. wSOL wrap/unwrap):
  // note it explicitly.
  const createdAddrs = new Set(accountsCreated.map((a) => a.address));
  for (const action of actions) {
    if (action.kind === 'close-account' && createdAddrs.has(action.account)) {
      warnings.push({
        code: 'partial-decode',
        message: `account ${action.account} was created and closed within this transaction (temporary ATA)`,
      });
    }
  }

  // Self-transfer note (from == to) → no net movement.
  for (const action of actions) {
    if (
      (action.kind === 'sol-transfer' || action.kind === 'token-transfer') &&
      action.from === action.to
    ) {
      warnings.push({
        code: 'ambiguous-amount',
        message: 'no net token movement (self-transfer)',
      });
    }
  }

  const programsInvoked: ProgramInvocation[] = [...invocationCounts.entries()].map(
    ([programId, count]) => {
      const known = knownProgram(programId);
      return { programId, ...(known ? { name: known.name } : {}), count };
    },
  );

  return { decoded, actions, accountsCreated, approvals, programsInvoked, warnings };
}
