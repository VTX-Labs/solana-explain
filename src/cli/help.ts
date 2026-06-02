/**
 * Branded --help text + examples.
 */

import { createStyler } from '../render/ansi.js';

export function helpText(color: boolean): string {
  const s = createStyler(color);
  const b = s.brand;
  const d = s.dim;
  const bold = s.bold;

  return `
${b('  ██╗   ██╗████████╗██╗  ██╗  ██╗      █████╗ ██████╗ ███████╗')}
${b('  ██║   ██║╚══██╔══╝╚██╗██╔╝  ██║     ██╔══██╗██╔══██╗██╔════╝')}
${b('  ██║   ██║   ██║    ╚███╔╝   ██║     ███████║██████╔╝███████╗')}
${b('  ╚██╗ ██╔╝   ██║    ██╔██╗   ██║     ██╔══██║██╔══██╗╚════██║')}
${b('   ╚████╔╝    ██║   ██╔╝ ██╗  ███████╗██║  ██║██████╔╝███████║')}
${b('    ╚═══╝     ╚═╝   ╚═╝  ╚═╝  ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝')}
  ${bold('solana-explain')}  ${d('· plain-English Solana tx reports · vtxlabs.dev')}

${bold('USAGE')}
  solana-explain <input> [options]
  solana-explain --stdin [options]
  solana-explain --file <path> [options]

  <input> is auto-detected: a base58 signature, a base64/base58 serialized
  transaction, or '-' / --stdin for piped data. JSON instruction sets are
  accepted only via --stdin or --file (a JSON array of instructions).

${bold('OPTIONS')}
  -r, --rpc <url>          RPC endpoint URL. Falls back to $SOLANA_RPC_URL, then
                           $RPC_URL. Required if neither is set.
  -c, --commitment <c>     processed | confirmed | finalized   ${d('(default: confirmed)')}
      --cluster <name>     Preset for -r: mainnet | devnet | testnet | localnet
      --simulate           Force the simulate path even for a signature input
      --focus <pubkey>     Phrase balance deltas from this account's perspective
  -j, --json               Emit machine-readable JSON (the ExplainResult)
      --markdown           Emit Markdown (great for issues / PRs / docs)
      --raw                Include the raw RPC payload under result.raw (with -j)
      --no-color           Disable ANSI color (auto-off when !isTTY or $NO_COLOR)
      --max-tx-version <n> Max supported tx version for getTransaction ${d('(default: 0)')}
      --timeout <ms>       Per-run network timeout ${d('(default: 30000)')}
      --stdin              Read input from stdin
      --file <path>        Read input from a file
      --fee-payer <pubkey> Fee payer for JSON instruction-set input
  -q, --quiet              Only the summary line + nonzero exit on failure
  -v, --verbose            Show every instruction incl. inner/CPI tree + raw args
      --version            Print version and exit
  -h, --help               Show this help and exit

${bold('EXAMPLES')}
  ${d('# Explain a confirmed transaction by signature')}
  solana-explain 5Nq...d8 --rpc https://api.mainnet-beta.solana.com

  ${d('# Simulate & explain a base64 transaction piped from another tool')}
  cat unsigned.b64 | solana-explain --stdin --simulate -r $SOLANA_RPC_URL

  ${d('# Explain an instruction set from a file as machine-readable JSON')}
  solana-explain --file ixs.json --fee-payer 7Bf...a21 --cluster devnet -j

${bold('EXIT CODES')}
  0 success   2 tx failed   3 not found   4 bad input   5 RPC error
  6 sim rejected   1 internal error   130 aborted (Ctrl-C)
`;
}
