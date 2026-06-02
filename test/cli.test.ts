import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import bs58 from 'bs58';
import { run } from '../src/cli/index.js';
import {
  buildSignatureResponse,
  compile,
  pk,
  systemTransferIx,
  SYSTEM,
} from './helpers.js';
import { stripAnsi } from '../src/render/ansi.js';

const PAYER = pk(1);
const RECIPIENT = pk(2);

/** A fake WriteStream that captures output. */
function capture(): { stream: NodeJS.WriteStream; text: () => string } {
  let buf = '';
  const s = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  }) as unknown as NodeJS.WriteStream;
  (s as { isTTY?: boolean }).isTTY = false;
  return { stream: s, text: () => buf };
}

function ioWith(rpcUrl: string, extraEnv: Record<string, string> = {}) {
  const out = capture();
  const err = capture();
  return {
    out,
    err,
    io: {
      stdout: out.stream,
      stderr: err.stream,
      env: { SOLANA_RPC_URL: rpcUrl, NO_COLOR: '1', ...extraEnv } as NodeJS.ProcessEnv,
    },
  };
}

// We cannot inject an RpcClient through the CLI arg surface (it takes a URL),
// so for output/exit-code tests we monkeypatch via a global the CLI does not
// use; instead we test the parts that don't need the network plus a spawn of
// --help / --version, and we use the library directly for RPC behavior.

describe('CLI: help & version', () => {
  it('--help prints branded usage and exits 0', async () => {
    const { out, io } = ioWith('');
    const code = await run(['--help'], io);
    expect(code).toBe(0);
    expect(stripAnsi(out.text())).toMatch(/USAGE/);
    expect(stripAnsi(out.text())).toMatch(/solana-explain/);
    expect(stripAnsi(out.text())).toMatch(/EXAMPLES/);
  });

  it('--version prints a version and exits 0', async () => {
    const { out, io } = ioWith('');
    const code = await run(['--version'], io);
    expect(code).toBe(0);
    expect(out.text().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('CLI: input & RPC errors', () => {
  it('exits 4 on empty input', async () => {
    const { io } = ioWith('https://example.com');
    const code = await run([], io);
    expect(code).toBe(4);
  });

  it('exits 4 when no RPC URL is configured', async () => {
    const { err, io } = ioWith('');
    const sig = bs58.encode(new Uint8Array(64));
    const code = await run([sig], { ...io, env: { NO_COLOR: '1' } as NodeJS.ProcessEnv });
    expect(code).toBe(4);
    expect(stripAnsi(err.text())).toMatch(/No RPC URL/i);
  });

  it('exits 4 on bad input', async () => {
    const { io } = ioWith('https://example.com');
    const code = await run(['!!!not-anything!!!'], io);
    expect(code).toBe(4);
  });
});

// The following tests exercise full output by injecting an RpcClient via the
// internal explain functions, then asserting the CLI-style rendering & exit
// codes through a thin wrapper around `run` is not possible (URL-only). So we
// verify exit-code mapping and rendering through the integration suite, and
// here we additionally verify the JSON/quiet rendering paths produce
// BigInt-safe, ANSI-free output using a local server-free RpcClient that the
// CLI can reach via a custom global fetch.

describe('CLI: full run via injected fetch', () => {
  function setupFetch(): () => void {
    const { txBytes } = compile([systemTransferIx(PAYER, RECIPIENT, 1_000_000_000n)], PAYER);
    const resp = buildSignatureResponse({
      txBytes,
      accountKeys: [PAYER, RECIPIENT, SYSTEM],
      preBalances: [2_000_000_000, 0, 1],
      postBalances: [999_995_000, 1_000_000_000, 1],
      fee: 5000,
      computeUnitsConsumed: 150,
    });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: resp }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    return () => {
      globalThis.fetch = orig;
    };
  }

  const SIG = bs58.encode(new Uint8Array(64).fill(7));

  it('prints human output and exits 0 for a successful tx', async () => {
    const restore = setupFetch();
    try {
      const { out, io } = ioWith('https://rpc.example.com');
      const code = await run([SIG], io);
      expect(code).toBe(0);
      const text = stripAnsi(out.text());
      expect(text).toMatch(/Summary/);
      expect(text).toMatch(/SOL/);
      // No ANSI when NO_COLOR.
      expect(out.text()).toBe(text);
    } finally {
      restore();
    }
  });

  it('-j emits valid JSON with BigInt-as-string', async () => {
    const restore = setupFetch();
    try {
      const { out, io } = ioWith('https://rpc.example.com');
      const code = await run([SIG, '-j'], io);
      expect(code).toBe(0);
      const parsed = JSON.parse(out.text());
      expect(typeof parsed.feeLamports).toBe('string');
      expect(parsed.feeLamports).toBe('5000');
    } finally {
      restore();
    }
  });

  it('-q prints only the summary', async () => {
    const restore = setupFetch();
    try {
      const { out, io } = ioWith('https://rpc.example.com');
      const code = await run([SIG, '-q'], io);
      expect(code).toBe(0);
      expect(out.text().trim().split('\n')).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('exits 3 when the tx is not found', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      const { io } = ioWith('https://rpc.example.com');
      const code = await run([SIG], io);
      expect(code).toBe(3);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('exits 2 when the tx FAILED', async () => {
    const { txBytes } = compile([systemTransferIx(PAYER, RECIPIENT, 1n)], PAYER);
    const resp = buildSignatureResponse({
      txBytes,
      accountKeys: [PAYER, RECIPIENT, SYSTEM],
      preBalances: [2_000_000_000, 0, 1],
      postBalances: [1_999_995_000, 0, 1],
      fee: 5000,
      err: { InstructionError: [0, { Custom: 1 }] },
    });
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: resp }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      const { io } = ioWith('https://rpc.example.com');
      const code = await run([SIG], io);
      expect(code).toBe(2);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('exits 5 on an RPC HTTP error', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    try {
      const { io } = ioWith('https://rpc.example.com');
      const code = await run([SIG], io);
      expect(code).toBe(5);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
