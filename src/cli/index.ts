#!/usr/bin/env node
/**
 * solana-explain CLI. Thin orchestrator over the library:
 * arg parsing (util.parseArgs), stdin/file reading, env-var RPC fallback,
 * SIGINT → exit 130, and exit-code mapping.
 */

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

import {
  explainSignature,
  explainTransaction,
  explainInstructions,
} from '../explain.js';
import { InputError, SimulationError, SolanaExplainError } from '../errors.js';
import type {
  Commitment,
  ExplainInstruction,
  ExplainResult,
} from '../types.js';
import { detectInput } from '../input/detect.js';
import { renderJson, renderMarkdown, renderText } from '../render/index.js';
import { shouldUseColor, createStyler } from '../render/ansi.js';
import { helpText } from './help.js';

const VERSION = '0.1.0';

const CLUSTER_URLS: Record<string, string> = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
  localhost: 'http://127.0.0.1:8899',
};

/** Map a SolanaExplainError to a CLI exit code. */
function exitCodeFor(err: SolanaExplainError): number {
  switch (err.code) {
    case 'TX_NOT_FOUND':
      return 3;
    case 'INVALID_INPUT':
    case 'INVALID_SIGNATURE':
    case 'INVALID_ENCODING':
    case 'EMPTY_INPUT':
    case 'DECODE_FAILED':
    case 'UNSUPPORTED_TX_VERSION':
      return 4;
    case 'RPC_HTTP':
    case 'RPC_JSON':
    case 'RPC_TIMEOUT':
      return 5;
    case 'SIMULATION_REJECTED':
      return 6;
    case 'ABORTED':
      return 130;
    default:
      return 1;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

interface ParsedCli {
  values: Record<string, unknown>;
  positionals: string[];
}

function parse(argv: string[]): ParsedCli {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      rpc: { type: 'string', short: 'r' },
      commitment: { type: 'string', short: 'c' },
      cluster: { type: 'string' },
      simulate: { type: 'boolean' },
      focus: { type: 'string' },
      json: { type: 'boolean', short: 'j' },
      markdown: { type: 'boolean' },
      raw: { type: 'boolean' },
      color: { type: 'boolean', default: true }, // --no-color sets false
      'max-tx-version': { type: 'string' },
      timeout: { type: 'string' },
      stdin: { type: 'boolean' },
      file: { type: 'string' },
      'fee-payer': { type: 'string' },
      quiet: { type: 'boolean', short: 'q' },
      verbose: { type: 'boolean', short: 'v' },
      version: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  return { values, positionals };
}

async function resolveInputString(
  values: Record<string, unknown>,
  positionals: string[],
  stderr: NodeJS.WriteStream,
): Promise<string> {
  const file = values['file'] as string | undefined;
  const wantsStdin = Boolean(values['stdin']) || positionals[0] === '-';

  if (file) {
    try {
      return await readFile(file, 'utf8');
    } catch (err) {
      throw new InputError(
        'INVALID_INPUT',
        `Cannot read file "${file}": ${err instanceof Error ? err.message : String(err)}`,
        { hint: 'Check the path and permissions.' },
      );
    }
  }

  if (wantsStdin) {
    if (process.stdin.isTTY) {
      stderr.write('waiting for piped input… (Ctrl-D to end; or pass <input> directly)\n');
    }
    const data = await readStdin();
    if (data.trim().length === 0) {
      throw new InputError('EMPTY_INPUT', 'Nothing was piped to stdin.', {
        hint: 'Pipe a signature/transaction, or pass <input> as an argument.',
      });
    }
    return data;
  }

  const positional = positionals[0];
  if (positional === undefined || positional.trim().length === 0) {
    throw new InputError('EMPTY_INPUT', 'No input provided.', {
      hint: 'Pass a signature/transaction, use --stdin, or --file <path>.',
    });
  }
  return positional;
}

function resolveRpcUrl(values: Record<string, unknown>, env: NodeJS.ProcessEnv): string {
  const cluster = values['cluster'] as string | undefined;
  const explicit = values['rpc'] as string | undefined;
  if (explicit) return explicit;
  if (cluster) {
    const url = CLUSTER_URLS[cluster.toLowerCase()];
    if (!url) {
      throw new InputError(
        'INVALID_INPUT',
        `Unknown cluster "${cluster}". Use mainnet | devnet | testnet | localnet.`,
      );
    }
    return url;
  }
  const fromEnv = env['SOLANA_RPC_URL'] ?? env['RPC_URL'];
  if (fromEnv) return fromEnv;
  throw new InputError('INVALID_INPUT', 'No RPC URL.', {
    hint: 'Pass --rpc <url>, --cluster <name>, or set SOLANA_RPC_URL.',
  });
}

export async function run(
  argv: string[],
  io: {
    stdout: NodeJS.WriteStream;
    stderr: NodeJS.WriteStream;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  },
): Promise<number> {
  let values: Record<string, unknown>;
  let positionals: string[];
  try {
    const parsed = parse(argv);
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    const colorEarly = shouldUseColor({ isTTY: io.stderr.isTTY, env: io.env });
    const s = createStyler(colorEarly);
    io.stderr.write(`${s.red('Error')} ${err instanceof Error ? err.message : String(err)}\n`);
    io.stderr.write(`Run ${s.bold('solana-explain --help')} for usage.\n`);
    return 4;
  }

  // Color: off for json/markdown, when --no-color, when not a TTY, or $NO_COLOR.
  const machineOutput = Boolean(values['json'] || values['markdown']);
  const colorEnabled =
    !machineOutput &&
    shouldUseColor({
      ...(values['color'] === false ? { explicit: false } : {}),
      isTTY: io.stdout.isTTY,
      env: io.env,
    });
  const s = createStyler(colorEnabled);
  const debug = Boolean(io.env['DEBUG']) || Boolean(values['verbose']);

  if (values['help']) {
    io.stdout.write(helpText(colorEnabled));
    return 0;
  }
  if (values['version']) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  try {
    const inputStr = await resolveInputString(values, positionals, io.stderr);
    const rpcUrl = resolveRpcUrl(values, io.env);

    const commitment = (values['commitment'] as Commitment | undefined) ?? 'confirmed';
    if (!['processed', 'confirmed', 'finalized'].includes(commitment)) {
      throw new InputError('INVALID_INPUT', `Invalid commitment "${commitment}".`);
    }

    const timeoutMs = values['timeout'] ? Number(values['timeout']) : undefined;
    const maxTxVersion = values['max-tx-version'] ? Number(values['max-tx-version']) : 0;

    const baseOpts = {
      rpc: rpcUrl,
      commitment,
      ...(values['focus'] ? { focusAccount: values['focus'] as string } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(io.signal ? { signal: io.signal } : {}),
      ...(values['raw'] ? { includeRaw: true } : {}),
    };

    let result: ExplainResult;
    const detected = detectInput(inputStr);

    if (values['simulate'] && detected.kind === 'signature') {
      // Force simulate is only meaningful for tx bytes; a bare signature can't
      // be simulated. Surface a clear input error.
      throw new InputError(
        'INVALID_INPUT',
        '--simulate requires a serialized transaction, not a signature.',
        { hint: 'Pipe a base64/base58 transaction with --simulate.' },
      );
    }

    if (detected.kind === 'signature') {
      result = await explainSignature(detected.signature, {
        ...baseOpts,
        maxSupportedTransactionVersion: maxTxVersion,
      });
    } else if (detected.kind === 'tx-bytes') {
      result = await explainTransaction(detected.bytes, {
        ...baseOpts,
        encoding: detected.encoding,
      });
    } else {
      const feePayer = (values['fee-payer'] as string | undefined) ?? '';
      if (!feePayer) {
        throw new InputError(
          'INVALID_INPUT',
          'Instruction-set input requires --fee-payer <pubkey>.',
          { hint: 'Add --fee-payer with the payer pubkey.' },
        );
      }
      result = await explainInstructions(detected.instructions as ExplainInstruction[], {
        ...baseOpts,
        feePayer,
      });
    }

    // ---- Output ----
    if (values['json']) {
      io.stdout.write(renderJson(result, { pretty: true }) + '\n');
    } else if (values['markdown']) {
      io.stdout.write(renderMarkdown(result));
    } else if (values['quiet']) {
      io.stdout.write(result.summary + '\n');
      // Warnings to stderr in quiet mode.
      for (const w of result.warnings) io.stderr.write(`${s.yellow('⚠')} ${w.message}\n`);
    } else {
      io.stdout.write(renderText(result, { color: colorEnabled, verbose: Boolean(values['verbose']) }) + '\n');
    }

    // Exit 2 if the tx failed/reverted but was still explained.
    return result.success ? 0 : 2;
  } catch (err) {
    return handleError(err, s, io.stderr, debug);
  }
}

function handleError(
  err: unknown,
  s: ReturnType<typeof createStyler>,
  stderr: NodeJS.WriteStream,
  debug: boolean,
): number {
  if (err instanceof SimulationError) {
    stderr.write(`${s.red('Error')} ${err.message}\n`);
    if (err.logs && err.logs.length > 0) {
      stderr.write(`${s.dim('Logs (tail):')}\n`);
      for (const l of err.logs) stderr.write(`${s.dim('  ' + l)}\n`);
    }
    if (err.hint) stderr.write(`${s.dim('Hint:')} ${err.hint}\n`);
    if (debug && err.cause) stderr.write(`${String(err.cause)}\n`);
    return exitCodeFor(err);
  }
  if (err instanceof SolanaExplainError) {
    stderr.write(`${s.red('Error')} ${err.message}\n`);
    if (err.hint) stderr.write(`${s.dim('Hint:')} ${err.hint}\n`);
    if (debug && err.cause) {
      stderr.write(`${s.dim('Cause:')} ${err.cause instanceof Error ? (err.cause.stack ?? err.cause.message) : String(err.cause)}\n`);
    }
    return exitCodeFor(err);
  }
  // Last-resort internal error.
  stderr.write(`${s.red('Internal error')} ${err instanceof Error ? err.message : String(err)}\n`);
  stderr.write(
    `${s.dim('This is likely a bug. Please report it: https://github.com/VTX-Labs/solana-explain/issues')}\n`,
  );
  if (debug && err instanceof Error && err.stack) stderr.write(`${err.stack}\n`);
  return 1;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on('SIGINT', onSigint);

  let exitCode: number;
  try {
    exitCode = await run(process.argv.slice(2), {
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env,
      signal: controller.signal,
    });
  } catch (err) {
    // run() is contracted not to throw, but be defensive.
    process.stderr.write(`Internal error: ${err instanceof Error ? err.message : String(err)}\n`);
    exitCode = 1;
  } finally {
    process.off('SIGINT', onSigint);
  }

  if (controller.signal.aborted) {
    process.exitCode = 130;
  } else {
    process.exitCode = exitCode;
  }
}

// Only run main() when executed directly (not when imported by tests). Uses the
// canonical ESM idiom: compare this module's URL to the invoked script's URL.
const isMain = (() => {
  try {
    const invoked = process.argv[1];
    if (!invoked) return false;
    return import.meta.url === pathToFileURL(invoked).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  void main();
}
