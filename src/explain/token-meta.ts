/**
 * Token metadata (symbol/decimals) resolution.
 *
 * Decimals come free from jsonParsed token balances / transferChecked. Symbols
 * are best-effort: a small built-in allowlist of well-known mints, applied
 * synchronously, with no network I/O — it covers the overwhelming majority of
 * user-facing transfers while keeping the core dependency-light and offline.
 */

export interface MintMeta {
  symbol: string;
  decimals: number;
}

/** Well-known mainnet mints. Keyed by mint address. */
export const KNOWN_MINTS: Readonly<Record<string, MintMeta>> = Object.freeze({
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  So11111111111111111111111111111111111111112: { symbol: "wSOL", decimals: 9 },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "mSOL", decimals: 9 },
  "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": {
    symbol: "stSOL",
    decimals: 9,
  },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": {
    symbol: "RAY",
    decimals: 6,
  },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP", decimals: 6 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", decimals: 5 },
});

/** The canonical wrapped-SOL mint. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Look up a known mint's metadata, or `undefined`. */
export function knownMint(mint: string): MintMeta | undefined {
  return KNOWN_MINTS[mint];
}

/** Resolve a symbol from the allowlist (best-effort, synchronous). */
export function resolveSymbol(mint: string): string | undefined {
  return KNOWN_MINTS[mint]?.symbol;
}

/** Is this the wrapped-SOL mint? */
export function isWsol(mint: string | undefined): boolean {
  return mint === WSOL_MINT;
}
