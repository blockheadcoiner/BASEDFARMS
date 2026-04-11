/**
 * Shared swap types — used by both jupiter.ts and raydium.ts
 * so SwapWidget can work with either router without changes.
 */

export interface NormalizedQuote {
  router: 'jupiter' | 'raydium';
  /** Differentiates Raydium sub-routers */
  subRouter?: 'cpmm' | 'launchpad';
  /** Raw output amount in the token's native units (as a string) */
  outAmountRaw: string;
  /** Minimum output after slippage, native units */
  minOutAmountRaw: string;
  /** Decimal places of the output token (e.g. 6 for BGM, 9 for SOL). Used for display. */
  outDecimals?: number;
  /** Price impact as a decimal percentage string e.g. "0.1200" */
  priceImpactPct: string;
  /** Human-readable route label */
  route: string;
  /** Platform fee expressed in SOL (null if not applicable) */
  platformFeeSol: string | null;
  slippageBps: number;
  /** Bonding curve graduation progress — present when subRouter === 'launchpad' */
  bondingProgress?: { raisedSol: number; targetSol: number; pct: number };
  /** Raw Jupiter QuoteResponse — present when router === 'jupiter' */
  _jupiterRaw?: unknown;
  /** Raw Raydium quote data — present when router === 'raydium' */
  _raydiumRaw?: unknown;
}
