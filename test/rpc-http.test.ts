import { describe, expect, it, vi } from 'vitest';
import { createHttpRpc } from '../src/rpc/http.js';
import { RpcError } from '../src/errors.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createHttpRpc', () => {
  it('parses a successful JSON-RPC result', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { value: { blockhash: 'abc', lastValidBlockHeight: 5 } } }),
    );
    const rpc = createHttpRpc('https://example.com', { fetch: fetchMock as unknown as typeof fetch });
    const bh = await rpc.getLatestBlockhash();
    expect(bh.blockhash).toBe('abc');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('maps a JSON-RPC error object to RpcError RPC_JSON', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } }),
    );
    const rpc = createHttpRpc('https://example.com', { fetch: fetchMock as unknown as typeof fetch });
    await expect(rpc.getLatestBlockhash()).rejects.toMatchObject({ code: 'RPC_JSON' });
  });

  it('retries once on HTTP 429 then succeeds', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('rate limited', { status: 429 });
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { value: { blockhash: 'ok', lastValidBlockHeight: 1 } } });
    });
    const rpc = createHttpRpc('https://example.com', { fetch: fetchMock as unknown as typeof fetch });
    const bh = await rpc.getLatestBlockhash();
    expect(bh.blockhash).toBe('ok');
    expect(calls).toBe(2);
  });

  it('throws RPC_HTTP with status after retry exhausted', async () => {
    const fetchMock = vi.fn(async () => new Response('still down', { status: 503 }));
    const rpc = createHttpRpc('https://example.com', { fetch: fetchMock as unknown as typeof fetch });
    await expect(rpc.getLatestBlockhash()).rejects.toMatchObject({ code: 'RPC_HTTP' });
  });

  it('maps non-JSON body to RPC_JSON with snippet', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('<html>captive portal</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const rpc = createHttpRpc('https://example.com', { fetch: fetchMock as unknown as typeof fetch });
    await expect(rpc.getLatestBlockhash()).rejects.toMatchObject({ code: 'RPC_JSON' });
  });

  it('honors an already-aborted signal', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal?.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { value: { blockhash: 'x', lastValidBlockHeight: 1 } } });
    });
    const controller = new AbortController();
    controller.abort();
    const rpc = createHttpRpc('https://example.com', { fetch: fetchMock as unknown as typeof fetch });
    await expect(rpc.getLatestBlockhash({ signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED',
    });
  });

  it('maps version errors to UNSUPPORTED_TX_VERSION', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32015, message: 'Transaction version (0) is not supported' },
      }),
    );
    const rpc = createHttpRpc('https://example.com', { fetch: fetchMock as unknown as typeof fetch });
    await expect(rpc.getTransaction('sig', { commitment: 'confirmed' })).rejects.toBeInstanceOf(RpcError);
    await expect(rpc.getTransaction('sig', { commitment: 'confirmed' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_TX_VERSION',
    });
  });
});
