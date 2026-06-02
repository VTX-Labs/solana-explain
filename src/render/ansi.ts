/**
 * Tiny hand-rolled ANSI styler (~no deps). Color auto-detection built in:
 * off when not a TTY, when `NO_COLOR` is set, or when explicitly disabled.
 */

const ESC = `${String.fromCharCode(27)}[`;
const RESET = `${ESC}0m`;

const CODES = {
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  gray: `${ESC}90m`,
  // VTX brand blue (#3182ce) via 256-color approximation.
  brand: `${ESC}38;5;33m`,
} as const;

export type StyleName = keyof typeof CODES;

export interface Styler {
  enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  blue(s: string): string;
  magenta(s: string): string;
  cyan(s: string): string;
  gray(s: string): string;
  brand(s: string): string;
}

function wrap(enabled: boolean, code: string, s: string): string {
  return enabled ? `${code}${s}${RESET}` : s;
}

export function createStyler(enabled: boolean): Styler {
  return {
    enabled,
    bold: (s) => wrap(enabled, CODES.bold, s),
    dim: (s) => wrap(enabled, CODES.dim, s),
    red: (s) => wrap(enabled, CODES.red, s),
    green: (s) => wrap(enabled, CODES.green, s),
    yellow: (s) => wrap(enabled, CODES.yellow, s),
    blue: (s) => wrap(enabled, CODES.blue, s),
    magenta: (s) => wrap(enabled, CODES.magenta, s),
    cyan: (s) => wrap(enabled, CODES.cyan, s),
    gray: (s) => wrap(enabled, CODES.gray, s),
    brand: (s) => wrap(enabled, CODES.brand, s),
  };
}

/**
 * Decide whether color should be on, given an explicit preference and the
 * environment. Explicit `true`/`false` wins; otherwise auto-detect.
 */
export function shouldUseColor(opts: {
  explicit?: boolean;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (opts.explicit !== undefined) return opts.explicit;
  const env = opts.env ?? {};
  if (env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '') return false;
  if (env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '0' && env['FORCE_COLOR'] !== '') {
    return true;
  }
  return Boolean(opts.isTTY);
}

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\[[0-9;]*m`, 'g');

/** Strip ANSI escape codes from a string (for width calc / tests). */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}
