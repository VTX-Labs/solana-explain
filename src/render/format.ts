/**
 * Pure formatting helpers: lamports→SOL, ui-amount, address shortening,
 * column alignment, number grouping. No I/O, no color.
 */

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Group a non-negative integer string with thousands separators. */
export function groupThousands(intStr: string): string {
  const neg = intStr.startsWith('-');
  const digits = neg ? intStr.slice(1) : intStr;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${grouped}` : grouped;
}

/** Format a base-unit bigint with `decimals` into a trimmed decimal string. */
export function formatUnits(amount: bigint, decimals: number): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  if (decimals <= 0) {
    return (neg ? '-' : '') + groupThousands(abs.toString());
  }
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const wholeStr = groupThousands(whole.toString());
  const sign = neg ? '-' : '';
  return fracStr.length > 0 ? `${sign}${wholeStr}.${fracStr}` : `${sign}${wholeStr}`;
}

/** Lamports → SOL string (9 decimals, trimmed). */
export function lamportsToSol(lamports: bigint): string {
  return formatUnits(lamports, 9);
}

/** Lamports → SOL number of decimal places preserved; convenience for "X SOL". */
export function solLabel(lamports: bigint): string {
  return `${lamportsToSol(lamports)} SOL`;
}

export { LAMPORTS_PER_SOL };

/** A signed UI delta like `"+1.5 SOL"` / `"-250 USDC"`. */
export function signedUi(delta: bigint, decimals: number, symbol?: string): string {
  const sign = delta > 0n ? '+' : '';
  const body = formatUnits(delta, decimals);
  const unit = symbol ? ` ${symbol}` : '';
  return `${sign}${body}${unit}`;
}

/** Shorten a base58 address to `abcd…wxyz` (4 + 4 by default). */
export function shortAddr(addr: string, head = 4, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Format a Unix seconds timestamp as `YYYY-MM-DD HH:MM UTC`. */
export function formatBlockTime(blockTime: number | null | undefined): string | undefined {
  if (blockTime === null || blockTime === undefined) return undefined;
  const d = new Date(blockTime * 1000);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/** Pad a visible string to width (ignoring ANSI is the caller's concern). */
export function padEndVisible(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/** Format a count with thousands separators. */
export function formatCount(n: number): string {
  return groupThousands(Math.trunc(n).toString());
}
