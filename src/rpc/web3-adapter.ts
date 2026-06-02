/**
 * `fromWeb3Rpc`: adapt an existing `@solana/web3.js` v1 `Connection` or a
 * `@solana/kit` / web3.js v2 RPC object to our {@link RpcClient}, by
 * duck-typing its methods. We never import web3.js — it stays an optional peer.
 */

import { RpcError, wrapError } from '../errors.js';
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

type AnyFn = (...args: unknown[]) => unknown;

interface DuckConnection {
  getTransaction?: AnyFn;
  simulateTransaction?: AnyFn;
  getMultipleAccountsInfo?: AnyFn;
  getMultipleParsedAccounts?: AnyFn;
  getLatestBlockhash?: AnyFn;
}

interface DuckKitRpc {
  getTransaction?: (...a: unknown[]) => { send: () => Promise<unknown> };
  simulateTransaction?: (...a: unknown[]) => { send: () => Promise<unknown> };
  getMultipleAccounts?: (...a: unknown[]) => { send: () => Promise<unknown> };
  getLatestBlockhash?: (...a: unknown[]) => { send: () => Promise<unknown> };
}

function isKitRpc(rpc: unknown): rpc is DuckKitRpc {
  if (typeof rpc !== 'object' || rpc === null) return false;
  const gt = (rpc as Record<string, unknown>)['getTransaction'];
  if (typeof gt !== 'function') return false;
  // Kit builders return a request object with `.send`; v1 returns a Promise.
  try {
    // We can't safely invoke without params; rely on the presence of a
    // `getMultipleAccounts` (kit) vs `getMultipleAccountsInfo` (v1) method.
    return (
      typeof (rpc as Record<string, unknown>)['getMultipleAccounts'] === 'function' &&
      typeof (rpc as Record<string, unknown>)['getMultipleAccountsInfo'] !== 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Wrap a web3.js v1 `Connection` or a kit RPC into an {@link RpcClient}.
 * Throws {@link RpcError} if the object exposes neither shape.
 */
export function fromWeb3Rpc(rpc: unknown): RpcClient {
  if (typeof rpc !== 'object' || rpc === null) {
    throw new RpcError('RPC_HTTP', 'fromWeb3Rpc expects a Connection or RPC object.');
  }

  if (isKitRpc(rpc)) {
    return fromKit(rpc);
  }
  return fromV1Connection(rpc as DuckConnection);
}

function fromV1Connection(conn: DuckConnection): RpcClient {
  if (typeof conn.getTransaction !== 'function') {
    throw new RpcError(
      'RPC_HTTP',
      'fromWeb3Rpc: object does not look like a web3.js Connection (missing getTransaction).',
    );
  }
  return {
    async getTransaction(sig: string, o: GetTransactionOpts): Promise<RawTransactionResponse | null> {
      try {
        const res = await conn.getTransaction!(sig, {
          commitment: o.commitment ?? 'confirmed',
          maxSupportedTransactionVersion: o.maxSupportedTransactionVersion ?? 0,
        });
        return (res as RawTransactionResponse | null) ?? null;
      } catch (err) {
        throw wrapError(err, 'RPC_HTTP', 'getTransaction failed');
      }
    },
    async simulateTransaction(txBase64: string, o: SimulateOpts): Promise<RawSimulateResponse> {
      try {
        // v1 simulate signature varies; we pass our config through and let the
        // connection accept what it can.
        const res = await conn.simulateTransaction!(txBase64, {
          sigVerify: o.sigVerify ?? false,
          replaceRecentBlockhash: o.replaceRecentBlockhash ?? true,
          commitment: o.commitment ?? 'confirmed',
          innerInstructions: o.innerInstructions ?? true,
          accounts: o.accounts
            ? { addresses: o.accounts.addresses, encoding: o.accounts.encoding ?? 'jsonParsed' }
            : undefined,
        });
        return res as RawSimulateResponse;
      } catch (err) {
        throw wrapError(err, 'SIMULATION_REJECTED', 'simulateTransaction failed');
      }
    },
    async getMultipleAccounts(
      addresses: string[],
      o: GetAccountsOpts,
    ): Promise<(RawAccount | null)[]> {
      if (addresses.length === 0) return [];
      try {
        // Token-balance parsing needs the jsonParsed shape (data.program +
        // data.parsed.info.tokenAmount). web3.js v1's getMultipleAccountsInfo
        // returns AccountInfo<Buffer> — a raw Buffer that our parser cannot read,
        // which would SILENTLY drop all token deltas. So we strongly prefer
        // getMultipleParsedAccounts and only fall back with a clear error.
        if (typeof conn.getMultipleParsedAccounts === 'function') {
          const res = (await conn.getMultipleParsedAccounts(addresses, {
            commitment: o.commitment ?? 'confirmed',
          })) as { value?: unknown[] } | unknown[];
          const arr = Array.isArray(res) ? res : (res.value ?? []);
          return arr.map((a) => normalizeV1Account(a));
        }
        if (typeof conn.getMultipleAccountsInfo === 'function') {
          throw new RpcError(
            'RPC_HTTP',
            'fromWeb3Rpc: this web3.js v1 Connection only exposes getMultipleAccountsInfo, ' +
              'which returns raw Buffers — token balances cannot be parsed and would be ' +
              'silently dropped. Use a Connection that supports getMultipleParsedAccounts, ' +
              'or pass an RPC URL string / kit RPC instead.',
          );
        }
        throw new RpcError('RPC_HTTP', 'Connection lacks getMultipleParsedAccounts.');
      } catch (err) {
        throw wrapError(err, 'RPC_HTTP', 'getMultipleAccounts failed');
      }
    },
    async getLatestBlockhash(
      o?: { commitment?: Commitment },
    ): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
      try {
        const res = (await conn.getLatestBlockhash!({
          commitment: o?.commitment ?? 'confirmed',
        })) as { blockhash: string; lastValidBlockHeight: number };
        return res;
      } catch (err) {
        throw wrapError(err, 'RPC_HTTP', 'getLatestBlockhash failed');
      }
    },
  };
}

function fromKit(rpc: DuckKitRpc): RpcClient {
  const send = async <T>(builder: { send: () => Promise<unknown> }): Promise<T> => {
    return (await builder.send()) as T;
  };
  return {
    async getTransaction(sig: string, o: GetTransactionOpts): Promise<RawTransactionResponse | null> {
      try {
        const builder = rpc.getTransaction!(sig, {
          encoding: 'base64',
          commitment: o.commitment ?? 'confirmed',
          maxSupportedTransactionVersion: o.maxSupportedTransactionVersion ?? 0,
        });
        return (await send<RawTransactionResponse | null>(builder)) ?? null;
      } catch (err) {
        throw wrapError(err, 'RPC_HTTP', 'getTransaction failed');
      }
    },
    async simulateTransaction(txBase64: string, o: SimulateOpts): Promise<RawSimulateResponse> {
      try {
        const builder = rpc.simulateTransaction!(txBase64, {
          encoding: 'base64',
          sigVerify: o.sigVerify ?? false,
          replaceRecentBlockhash: o.replaceRecentBlockhash ?? true,
          commitment: o.commitment ?? 'confirmed',
          innerInstructions: o.innerInstructions ?? true,
          accounts: o.accounts
            ? { addresses: o.accounts.addresses, encoding: o.accounts.encoding ?? 'jsonParsed' }
            : undefined,
        });
        return await send<RawSimulateResponse>(builder);
      } catch (err) {
        throw wrapError(err, 'SIMULATION_REJECTED', 'simulateTransaction failed');
      }
    },
    async getMultipleAccounts(
      addresses: string[],
      o: GetAccountsOpts,
    ): Promise<(RawAccount | null)[]> {
      if (addresses.length === 0) return [];
      try {
        const builder = rpc.getMultipleAccounts!(addresses, {
          commitment: o.commitment ?? 'confirmed',
          encoding: o.encoding ?? 'jsonParsed',
        });
        const res = await send<{ value: (RawAccount | null)[] }>(builder);
        return res.value;
      } catch (err) {
        throw wrapError(err, 'RPC_HTTP', 'getMultipleAccounts failed');
      }
    },
    async getLatestBlockhash(
      o?: { commitment?: Commitment },
    ): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
      try {
        const builder = rpc.getLatestBlockhash!({ commitment: o?.commitment ?? 'confirmed' });
        const res = await send<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
          builder,
        );
        return res.value;
      } catch (err) {
        throw wrapError(err, 'RPC_HTTP', 'getLatestBlockhash failed');
      }
    },
  };
}

/**
 * Map a web3.js v1 parsed account (from getMultipleParsedAccounts) into our
 * {@link RawAccount}. v1 returns `{ lamports: number, owner: PublicKey,
 * data: ParsedAccountData | Buffer, ... }`; we keep `data` as-is so the
 * jsonParsed shape (`{ program, parsed }`) flows straight through to the token
 * parser. PublicKey values are coerced to base58 strings via toString().
 */
function normalizeV1Account(a: unknown): RawAccount | null {
  if (a === null || typeof a !== 'object') return null;
  const acc = a as {
    lamports?: unknown;
    owner?: unknown;
    data?: unknown;
    executable?: unknown;
    rentEpoch?: unknown;
    space?: unknown;
  };
  if (typeof acc.lamports !== 'number') return null;
  const owner =
    typeof acc.owner === 'string'
      ? acc.owner
      : acc.owner != null && typeof (acc.owner as { toString?: () => string }).toString === 'function'
        ? (acc.owner as { toString: () => string }).toString()
        : '';
  return {
    lamports: acc.lamports,
    owner,
    data: acc.data,
    executable: Boolean(acc.executable),
    ...(typeof acc.rentEpoch === 'number' || typeof acc.rentEpoch === 'string'
      ? { rentEpoch: acc.rentEpoch }
      : {}),
    ...(typeof acc.space === 'number' ? { space: acc.space } : {}),
  };
}
