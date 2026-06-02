```
██╗   ██╗████████╗██╗  ██╗  ██╗      █████╗ ██████╗ ███████╗
██║   ██║╚══██╔══╝╚██╗██╔╝  ██║     ██╔══██╗██╔══██╗██╔════╝
██║   ██║   ██║    ╚███╔╝   ██║     ███████║██████╔╝███████╗
╚██╗ ██╔╝   ██║    ██╔██╗   ██║     ██╔══██║██╔══██╗╚════██║
 ╚████╔╝    ██║   ██╔╝ ██╗  ███████╗██║  ██║██████╔╝███████║
  ╚═══╝     ╚═╝   ╚═╝  ╚═╝  ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝
```

# solana-explain

### Plain-English "what this actually does" reports for any Solana transaction — no IDLs required.

[![npm](https://img.shields.io/npm/v/@vtx-labs/solana-explain?color=3182ce&label=npm&style=flat-square)](https://www.npmjs.com/package/@vtx-labs/solana-explain)
[![CI](https://img.shields.io/github/actions/workflow/status/VTX-Labs/solana-explain/ci.yml?branch=main&color=3182ce&label=CI&style=flat-square)](https://github.com/VTX-Labs/solana-explain/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-3182ce.svg?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-3182ce?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3182ce?style=flat-square)](https://www.typescriptlang.org)

---

`@vtx-labs/solana-explain` turns any Solana **transaction signature**, **raw/base64 transaction**, or **unsigned instruction set** into a clear report of what it actually does — net balance deltas, SOL & SPL/Token-2022 transfers, account creations, approvals/revokes, and program invocations.

It **fetches** (by signature) or **simulates** (for unsigned/raw) a transaction over any RPC URL, diffs pre/post account + token balances, and decodes instructions with bundled byte-level decoders for the most common programs (System, SPL Token, Token-2022, ATA, Memo, Compute Budget) plus best-effort recognition for Metaplex, Jupiter, Raydium, Orca, Stake, Vote, and more.

- **No user-supplied IDLs.** The _truth_ of "what changed" is the balance diff; decoding adds names and intent.
- **Dependency-light.** One runtime dep (`bs58`). `@solana/web3.js` is an optional peer — bring your own RPC or use the built-in `fetch` client.
- **Library + CLI.** A structured `ExplainResult` for programs, and a colorized CLI for humans.
- **`npx` zero-config.** `npx @vtx-labs/solana-explain <signature> --rpc <url>`.

---

## Install

```bash
npm install @vtx-labs/solana-explain
# or run the CLI with no install:
npx @vtx-labs/solana-explain <signature> --rpc https://your-rpc
```

> Requires Node 18+ (uses the global `fetch`).

---

## Quick start (library)

```ts
import { explainSignature, renderText } from "@vtx-labs/solana-explain";

const result = await explainSignature("5Nq...d8", {
  rpc: "https://api.mainnet-beta.solana.com",
  commitment: "confirmed",
});

console.log(result.summary);
// "Swapped 1.500015 SOL for 248.91 USDC via Jupiter v6, paid 0.000005 SOL fee."

console.log(renderText(result, { color: true }));
```

Simulate an **unsigned** transaction (base64 / base58 / `Uint8Array`):

```ts
import { explainTransaction } from "@vtx-labs/solana-explain";

const result = await explainTransaction(base64Tx, {
  rpc: process.env.SOLANA_RPC_URL!,
  // sigVerify defaults to false, replaceRecentBlockhash defaults to true,
  // so unsigned txs simulate cleanly.
});
```

Explain raw **instructions** before signing in a wallet:

```ts
import { explainInstructions } from "@vtx-labs/solana-explain";

const result = await explainInstructions(instructions, {
  rpc: rpcUrl,
  feePayer: walletPubkey, // required to assemble a simulatable message
});
```

Auto-detect the input kind:

```ts
import { explain } from "@vtx-labs/solana-explain";

const result = await explain(inputThatCouldBeAnything, { rpc: rpcUrl });
```

---

## CLI

```
solana-explain <input> [options]
solana-explain --stdin [options]
```

`<input>` is auto-detected: a base58 signature, a base64/base58 serialized transaction, a file path, or `-`/`--stdin` for piped data.

```
  -r, --rpc <url>          RPC endpoint URL. Falls back to $SOLANA_RPC_URL, then $RPC_URL.
  -c, --commitment <c>     processed | confirmed | finalized   (default: confirmed)
      --cluster <name>     Preset for -r: mainnet | devnet | testnet | localnet
      --simulate           Force the simulate path even for a signature input
      --focus <pubkey>     Phrase balance deltas from this account's perspective
  -j, --json               Emit machine-readable JSON (the ExplainResult; BigInts as strings)
      --markdown           Emit Markdown (great for issues / PRs / docs)
      --raw                Include the raw RPC payload under result.raw (with -j)
      --no-color           Disable ANSI color (auto-off when !isTTY or $NO_COLOR)
      --max-tx-version <n> Max supported tx version for getTransaction (default: 0)
      --timeout <ms>       Per-run network timeout (default: 30000)
      --stdin              Read input from stdin
      --file <path>        Read input from a file
      --fee-payer <pubkey> Fee payer for JSON instruction-set input
  -q, --quiet              Only the summary line + nonzero exit on failure
  -v, --verbose            Show every instruction incl. inner/CPI tree + raw args
      --version            Print version and exit
  -h, --help               Show help and exit
```

### Example output

```
  Solana transaction · confirmed · slot 287,330,114 · 2026-05-30 14:02 UTC
  Signature  5Nq...d8                                        ✓ Success

  Summary    Swapped 1.500015 SOL for 248.91 USDC via Jupiter v6, paid 0.000005 SOL fee.

  Balance changes
    7Bf…a21           -1.500015 SOL      +248.91 USDC
    9Qm…f0            +1.500000 SOL      -248.91 USDC

  Actions
    1. Set compute budget: unit limit 200,000, price 1,000 µ-lamports
    2. Transfer 1.500015 SOL  7Bf…a21 → 9Qm…f0
    3. Call Jupiter v6  — effect inferred from balance diff (no IDL)
    4. Transfer 248.91 USDC  9Qm…f0 → 7Bf…a21

  Programs   Compute Budget · System · SPL Token · Jupiter v6
  Fee        0.000005 SOL        Compute   142,318 units

  ⚠ 1 warning
    · Jupiter v6 recognized by program id; semantics inferred from balance diff (no IDL).
```

### Exit codes

| Code  | Meaning                                                                              |
| ----- | ------------------------------------------------------------------------------------ |
| `0`   | Success — explained, on-chain/sim success                                            |
| `2`   | Explained, but the transaction **failed/reverted** (`success:false`) — still printed |
| `3`   | Transaction not found at the requested commitment                                    |
| `4`   | Invalid input (bad signature/encoding/empty)                                         |
| `5`   | RPC/network error (HTTP, JSON-RPC, timeout)                                          |
| `6`   | Simulation rejected by the node (e.g. bad blockhash)                                 |
| `1`   | Unexpected internal error                                                            |
| `130` | Aborted via SIGINT (Ctrl-C)                                                          |

---

## API

All exports are **named** (no default exports). Types are `type`-importable.

### Primary helpers

```ts
function explainSignature(
  signature: string,
  options: ExplainSignatureOptions,
): Promise<ExplainResult>;
function explainTransaction(
  tx: string | Uint8Array,
  options: ExplainTransactionOptions,
): Promise<ExplainResult>;
function explainInstructions(
  instructions: ExplainInstruction[],
  options: ExplainInstructionsOptions,
): Promise<ExplainResult>;
function explain(
  input: string | Uint8Array | ExplainInstruction[],
  options: ExplainOptions,
): Promise<ExplainResult>;
```

### Building blocks (pure, RPC-free where possible)

```ts
function buildExplanation(input: ExplainInput): ExplainResult; // diff + decode + narrate
function decodeInstruction(
  ix: CompiledInstructionView,
  registry?: ProgramRegistry,
): DecodedInstruction;
function diffBalances(
  pre: BalanceSnapshot,
  post: BalanceSnapshot,
): BalanceDelta[];
```

### Rendering (pure) — also at `@vtx-labs/solana-explain/render`

```ts
function renderText(result: ExplainResult, opts?: RenderOptions): string; // colorized when opts.color
function renderMarkdown(result: ExplainResult): string;
function renderJson(result: ExplainResult, opts?: { pretty?: boolean }): string; // BigInt-safe
```

### RPC abstraction

```ts
function createHttpRpc(url: string, opts?: HttpRpcOptions): RpcClient; // zero-dep fetch client
function fromWeb3Rpc(rpc: unknown): RpcClient; // adapt web3.js v1 / @solana/kit
```

The library only ever talks to the `RpcClient` interface, so it is network-source-agnostic and `@solana/web3.js` stays an optional peer dependency.

```ts
import { fromWeb3Rpc } from "@vtx-labs/solana-explain";
import { Connection } from "@solana/web3.js";

const rpc = fromWeb3Rpc(new Connection(url));
const result = await explainSignature(sig, { rpc });
```

### Program registry — also at `@vtx-labs/solana-explain/programs`

```ts
const defaultRegistry: ProgramRegistry;
function createRegistry(decoders?: ProgramDecoder[]): ProgramRegistry;
const KNOWN_PROGRAMS: Readonly<Record<string, KnownProgramInfo>>;
```

Register a custom byte-level decoder without an IDL:

```ts
import { createRegistry } from "@vtx-labs/solana-explain/programs";
import type { ProgramDecoder } from "@vtx-labs/solana-explain";

const myDecoder: ProgramDecoder = {
  programId: "MyProgram1111111111111111111111111111111111",
  name: "My Program",
  kind: "other",
  decode(ix) {
    // ix.data is a Uint8Array; return { decoded: false } on anything unexpected.
    return { program: "My Program", type: "doThing", decoded: true, args: {} };
  },
};

const result = await explainSignature(sig, {
  rpc: rpcUrl,
  registry: createRegistry([myDecoder]),
});
```

### Errors

Every public async function rejects **only** with a `SolanaExplainError` subclass; the original is preserved on `.cause`.

```ts
class SolanaExplainError extends Error {
  code: ErrorCode;
  cause?: unknown;
  hint?: string;
}
class RpcError extends SolanaExplainError {} // transport / JSON-RPC
class DecodeError extends SolanaExplainError {} // malformed tx bytes
class SimulationError extends SolanaExplainError {} // sim rejected / reverted
class InputError extends SolanaExplainError {} // bad signature / encoding / empty
```

A **failed / reverted** transaction does **not** throw — it returns a fully-populated `ExplainResult` with `success:false`, the decoded program error, and all balance deltas (fees were charged), because you usually want to know _why_ it failed.

---

## How it works

```
input → detect → acquire (signature | simulate) → decode message → diff balances
      → correlate decoded ix + deltas → summarize → render
```

1. **Input** — classify signature vs tx-bytes vs instruction-set, normalizing encodings.
2. **RPC** — a tiny `RpcClient` over `fetch` (timeout, single jittered retry on 429/5xx, strict JSON-RPC mapping), or your own web3.js connection.
3. **Acquire** — _signature path_ uses `getTransaction` (authoritative pre/post token balances, fee, inner instructions, `err`); _simulate path_ fetches pre-state via `getMultipleAccounts` and post-state via `simulateTransaction`'s returned accounts, then diffs identically.
4. **Decode** — a hand-written legacy + v0 wire-message parser plus byte-level decoders (no `borsh`/`buffer-layout`; tiny fixed-byte enums via `DataView`).
5. **Diff + narrate** — signed lamport/token deltas, fused with decoded instructions into high-confidence `Action`s, then a one-line headline.
6. **Render** — sectioned text (hand-rolled ANSI, no `chalk`), Markdown, or BigInt-safe JSON.

All numeric on-chain quantities are `bigint`; `ui*` string fields carry human/decimal formatting so callers never lose precision.

---

## Edge cases handled

- Empty / whitespace input, wrong-length signatures (reports decoded byte count), garbage base64/base58.
- Ambiguous encoding (valid as both base58 and base64) — prefers the wire-message-parsing interpretation, warns on tie.
- Transaction not found at the requested commitment (`TX_NOT_FOUND`, suggests `--commitment finalized`).
- **Failed/reverted** transactions — `success:false`, decoded `InstructionError` → human text, deltas still shown.
- Versioned (v0) txs with address lookup tables — resolved via `loadedAddresses` on the signature path; warns `lut-unresolved` on the simulate path while still diffing resolved writable accounts.
- `maxSupportedTransactionVersion` too low → `UNSUPPORTED_TX_VERSION` with a hint.
- Token-2022 extensions (transfer fees, hooks, confidential transfer) — base transfer decoded; extension ixs flagged, fee impact still visible in the diff.
- Memos with invalid UTF-8 / huge payloads — lossy-decoded with replacement chars, truncated for display.
- Unchecked SPL transfers without decimals — pulled from token-balance entries; `ambiguous-amount` warning when unavailable.
- wSOL wrap/unwrap (`syncNative`), self-transfers (no net movement), zero-amount transfers, account created-and-closed in one tx.
- RPC HTML error pages, 429/5xx (one retry then `RPC_HTTP`), timeouts (`RPC_TIMEOUT`), SIGINT cancellation (exit 130).
- BigInt JSON serialization (never throws), Compute Budget prices beyond `Number.MAX_SAFE_INTEGER` kept as `bigint`.

---

## Scripts

```bash
npm run build       # tsup → ESM + .d.ts
npm test            # vitest
npm run typecheck   # tsc --noEmit (strict)
npm run dev         # tsx src/cli/index.ts
```

---

<div align="center">

Built by [**VTX Labs**](https://vtxlabs.dev) · MIT

</div>
