/**
 * `createHttpRpc`: zero-dep JSON-RPC over the global `fetch` (Node 18+).
 *
 * - Per-call timeout via AbortController, composed with the caller's signal.
 * - Single jittered-backoff retry on 429/5xx.
 * - Strict JSON-RPC error mapping → RpcError.
 */

import { RpcError, isAbortError } from '../errors.js';
import { normalizeRpcUrl } from '../input/encoding.js';
import type {
  GetAccountsOpts,
  GetTransactionOpts,
  RawAccount,
  RawSimulateResponse,
  RawTransactionResponse,
  RpcClient,
  SimulateOpts,
} from './types.js';
import type { Commitment } from '../types.js';

export interface HttpRpcOptions {
  /** Default per-call timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Extra HTTP headers (e.g. API key). */
  headers?: Record<string, string>;
  /** Override fetch (for testing). Defaults to global fetch. */
  fetch?: typeof fetch;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: JsonRpcError;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RpcError('ABORTED', 'Aborted while backing off.'));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new RpcError('ABORTED', 'Aborted while backing off.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Combine the caller's signal with a timeout signal into one. */
function combineSignals(timeoutMs: number, external?: AbortSignal): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
}

export function createHttpRpc(url: string, opts: HttpRpcOptions = {}): RpcClient {
  const endpoint = normalizeRpcUrl(url);
  const defaultTimeout = opts.timeoutMs ?? 30_000;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new RpcError(
      'RPC_HTTP',
      'global fetch is not available; use Node 18+ or pass a fetch implementation.',
    );
  }
  let idCounter = 1;

  async function call<T>(
    method: string,
    params: unknown[],
    timeoutMs: number,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    const body: JsonRpcRequest = { jsonrpc: '2.0', id: idCounter++, method, params };
    let attempt = 0;
    // 1 initial + 1 retry.
    for (;;) {
      const { signal, timedOut, cleanup } = combineSignals(timeoutMs, externalSignal);
      let res: Response;
      try {
        res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...opts.headers },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        cleanup();
        if (timedOut()) {
          throw new RpcError('RPC_TIMEOUT', `RPC request "${method}" timed out after ${timeoutMs}ms.`, {
            cause: err,
            hint: 'Increase --timeout or check your RPC URL.',
          });
        }
        if (isAbortError(err) || externalSignal?.aborted) {
          throw new RpcError('ABORTED', `RPC request "${method}" was aborted.`, { cause: err });
        }
        throw new RpcError('RPC_HTTP', `Network error calling "${method}": ${describeErr(err)}`, {
          cause: err,
          hint: 'Check connectivity and that the RPC URL is reachable.',
        });
      }
      cleanup();

      if (RETRY_STATUSES.has(res.status) && attempt < 1) {
        attempt++;
        const backoff = 250 + Math.floor(Math.random() * 400);
        await sleep(backoff, externalSignal);
        continue;
      }

      const text = await res.text();
      if (!res.ok) {
        throw new RpcError(
          'RPC_HTTP',
          `RPC HTTP ${res.status} ${res.statusText} for "${method}". Body: ${snippet(text)}`,
          res.status === 429
            ? { hint: 'Public endpoints are rate-limited; use a dedicated RPC.' }
            : {},
        );
      }

      let parsed: JsonRpcResponse<T>;
      try {
        parsed = JSON.parse(text) as JsonRpcResponse<T>;
      } catch (err) {
        throw new RpcError(
          'RPC_JSON',
          `RPC returned non-JSON for "${method}". Body: ${snippet(text)}`,
          { cause: err, hint: 'Is the RPC URL correct? A captive portal/HTML page may be intercepting.' },
        );
      }

      if (parsed.error) {
        const msg = `${parsed.error.message} (code ${parsed.error.code})`;
        // Common: maxSupportedTransactionVersion too low.
        if (/version|transaction version/i.test(parsed.error.message)) {
          throw new RpcError('UNSUPPORTED_TX_VERSION', `RPC: ${msg}`, {
            hint: 'Raise --max-tx-version (e.g. 0) to fetch versioned transactions.',
          });
        }
        throw new RpcError('RPC_JSON', `JSON-RPC error for "${method}": ${msg}`);
      }

      return parsed.result as T;
    }
  }

  return {
    async getTransaction(sig: string, o: GetTransactionOpts): Promise<RawTransactionResponse | null> {
      const config: Record<string, unknown> = {
        encoding: 'base64',
        commitment: o.commitment ?? 'confirmed',
      };
      if (o.maxSupportedTransactionVersion !== undefined) {
        config['maxSupportedTransactionVersion'] = o.maxSupportedTransactionVersion;
      }
      return call<RawTransactionResponse | null>(
        'getTransaction',
        [sig, config],
        defaultTimeout,
        o.signal,
      );
    },

    async simulateTransaction(txBase64: string, o: SimulateOpts): Promise<RawSimulateResponse> {
      const config: Record<string, unknown> = {
        encoding: 'base64',
        commitment: o.commitment ?? 'confirmed',
        sigVerify: o.sigVerify ?? false,
        replaceRecentBlockhash: o.replaceRecentBlockhash ?? true,
      };
      if (o.innerInstructions) config['innerInstructions'] = true;
      if (o.accounts) {
        config['accounts'] = {
          addresses: o.accounts.addresses,
          encoding: o.accounts.encoding ?? 'jsonParsed',
        };
      }
      return call<RawSimulateResponse>(
        'simulateTransaction',
        [txBase64, config],
        defaultTimeout,
        o.signal,
      );
    },

    async getMultipleAccounts(
      addresses: string[],
      o: GetAccountsOpts,
    ): Promise<(RawAccount | null)[]> {
      if (addresses.length === 0) return [];
      const config = {
        commitment: o.commitment ?? 'confirmed',
        encoding: o.encoding ?? 'jsonParsed',
      };
      const result = await call<{ value: (RawAccount | null)[] }>(
        'getMultipleAccounts',
        [addresses, config],
        defaultTimeout,
        o.signal,
      );
      return result.value;
    },

    async getLatestBlockhash(
      o?: { commitment?: Commitment; signal?: AbortSignal },
    ): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
      const result = await call<{
        value: { blockhash: string; lastValidBlockHeight: number };
      }>('getLatestBlockhash', [{ commitment: o?.commitment ?? 'confirmed' }], defaultTimeout, o?.signal);
      return result.value;
    },
  };
}

function snippet(text: string, n = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? `${oneLine.slice(0, n)}…` : oneLine;
}

function describeErr(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    return code ? `${err.message} (${code})` : err.message;
  }
  return String(err);
}
