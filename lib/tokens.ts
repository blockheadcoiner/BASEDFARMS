/**
 * Brand assets & platform constants for BASEDFARMS.fun
 *
 * BGM logo is served locally from /public/tokens/bgm-logo.png.
 *
 * fetchBgmMetadata() can optionally resolve a live logoURI from Jupiter
 * if BGM gets listed there — use it to override the local path at runtime.
 */

// ─── Platform ────────────────────────────────────────────────────────────────

/** Fee charged on every swap, in basis points (30 bps = 0.3%) */
export const PLATFORM_FEE_BPS = 30;

/** Platform fee as a human-readable percentage string */
export const PLATFORM_FEE_PCT = '0.3%';

/**
 * BASEDFARMS treasury wallet — receives the platform fee split.
 * Replace with the real address before going to production.
 */
export const TREASURY_WALLET = 'BASEDFARMS_TREASURY_PLACEHOLDER';

// ─── BGM token ───────────────────────────────────────────────────────────────

export const BGM_MINT     = '3nZg1VZjT8qbeVPPKFmQmj6zbSw8D42RnxSeae3Qbonk';
export const BGM_SYMBOL   = '$BGM';
export const BGM_NAME     = 'Based Goose Money';
export const BGM_DECIMALS = 6;

/** Local logo path — served from /public/tokens/. */
export const BGM_LOGO_PATH = '/tokens/bgm-logo.png';

/** Fallback rendered when the logo image fails to load. */
export const BGM_LOGO_FALLBACK = '🪿';

// ─── Static brand logo URLs ───────────────────────────────────────────────────

/** Solana logo (Solana Foundation CDN). */
export const SOLANA_LOGO_URL =
  'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png';

/** Jupiter logo (Jupiter CDN). */
export const JUPITER_LOGO_URL =
  'https://raw.githubusercontent.com/jup-ag/jup-token-list/main/assets/JUP.png';

// ─── BGM token bundle ─────────────────────────────────────────────────────────

export const BGM_TOKEN = {
  symbol:   BGM_SYMBOL,
  name:     BGM_NAME,
  mint:     BGM_MINT,
  decimals: BGM_DECIMALS,
  logoURI:  BGM_LOGO_PATH,
  fallback: BGM_LOGO_FALLBACK,
  verified: true,
  platform: 'BASEDFARMS',
} as const;

// ─── Jupiter token list (optional live resolution) ────────────────────────────

const JUPITER_TOKEN_LIST_URL = 'https://token.jup.ag/all';

export interface JupiterTokenInfo {
  address:  string;
  symbol:   string;
  name:     string;
  decimals: number;
  logoURI:  string | null;
  tags:     string[];
}

/**
 * Optionally resolves BGM's logoURI from the Jupiter token list.
 * Returns `null` if BGM is not listed or the request fails.
 * Falls back gracefully — always use BGM_TOKEN.logoURI as the default.
 *
 * @example
 * const live = await fetchBgmMetadata();
 * const logo = live?.logoURI ?? BGM_TOKEN.logoURI;
 */
export async function fetchBgmMetadata(): Promise<JupiterTokenInfo | null> {
  try {
    const res = await fetch(JUPITER_TOKEN_LIST_URL, {
      next: { revalidate: 3600 }, // cache 1 hour in Next.js
    });
    if (!res.ok) return null;
    const tokens: JupiterTokenInfo[] = await res.json();
    return tokens.find((t) => t.address === BGM_MINT) ?? null;
  } catch {
    return null;
  }
}
