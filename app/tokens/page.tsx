'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const pressStart = 'var(--font-press-start), "Courier New", monospace';
const font = "'Geist', -apple-system, BlinkMacSystemFont, sans-serif";
const PLATFORM_ID =
  process.env.NEXT_PUBLIC_PLATFORM_ID ?? '32SyS4SyyNK0AERNMk9vLjSdrJ9mUXrNkD5wUMASqHw4';
const LIST_URL = 'https://launch-mint-v1.raydium.io/get/list';

/* ── API types ────────────────────────────────────────────────────────────── */

interface LaunchToken {
  mint: string;
  poolId?: string;
  name: string;
  symbol: string;
  imgUrl?: string;
  metadataUrl?: string;
  createAt?: number;
  marketCap?: number;
  finishingRate?: number;
  migrateType?: string;
  platformInfo?: { pubKey: string; name?: string };
  decimals?: number;
  supply?: number;
}

async function fetchPlatformTokens(): Promise<LaunchToken[]> {
  const res = await fetch(
    `${LIST_URL}?sort=new&size=50&mintType=default&includeNsfw=false`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  const json = await res.json() as {
    success: boolean;
    data?: { rows?: LaunchToken[] };
  };
  if (!json.success) throw new Error('Raydium API returned success: false');
  const rows = json.data?.rows ?? [];
  return rows.filter((t) => t.platformInfo?.pubKey === PLATFORM_ID);
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000)       return 'just now';
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function curveProgress(t: LaunchToken): number {
  if (typeof t.finishingRate === 'number') return Math.min(100, Math.round(t.finishingRate));
  return 0;
}

function fmtMcap(t: LaunchToken): string {
  if (!t.marketCap) return '—';
  const n = t.marketCap;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M SOL`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K SOL`;
  return `${n.toFixed(2)} SOL`;
}

function statusInfo(t: LaunchToken) {
  if ((t.finishingRate ?? 0) >= 100) return { text: '✓ GRAD',    color: '#22c55e' };
  return                                     { text: '● LIVE',    color: '#f97316' };
}

function basedTier(name: string, symbol: string) {
  const nb = /based/i.test(name);
  const sb = /based/i.test(symbol);
  if (nb && sb) return { label: 'MAX BASED', color: '#f59e0b' };
  if (nb || sb) return { label: 'BASED',     color: '#22c55e' };
  return null;
}

function symbolHue(symbol: string) {
  return symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
}

/* ── Token Image ─────────────────────────────────────────────────────────── */

function TokenImage({ imgUrl, symbol, size }: { imgUrl?: string; symbol: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const hue = symbolHue(symbol);
  const letter = symbol.charAt(0).toUpperCase();

  if (imgUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imgUrl}
        alt={symbol}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block', flexShrink: 0 }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `hsl(${hue},30%,12%)`,
      border: `1px solid hsl(${hue},30%,22%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: pressStart,
      fontSize: `${Math.floor(size * 0.38)}px`,
      color: `hsl(${hue},50%,60%)`,
    }}>
      {letter}
    </div>
  );
}

/* ── Token Card ──────────────────────────────────────────────────────────── */

function TokenCard({ token }: { token: LaunchToken }) {
  const progress = curveProgress(token);
  const sl = statusInfo(token);
  const tier = basedTier(token.name, token.symbol);
  const barColor = progress >= 90 ? '#22c55e' : '#f97316';

  return (
    <div style={s.card}>
      {/* Header row: logo + name/symbol + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <TokenImage imgUrl={token.imgUrl} symbol={token.symbol} size={40} />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
            <span style={s.symbol}>${token.symbol}</span>
            {tier && (
              <span style={{ ...s.tierBadge, color: tier.color, borderColor: tier.color, background: `${tier.color}18` }}>
                ◈ {tier.label}
              </span>
            )}
          </div>
          <span style={s.tokenName}>{token.name}</span>
        </div>

        <span style={{ ...s.statusPill, color: sl.color }}>{sl.text}</span>
      </div>

      {/* Bonding curve progress */}
      <div style={s.progressSection}>
        <div style={s.progressHeader}>
          <span style={s.progressLabel}>CURVE PROGRESS</span>
          <span style={s.progressPct}>{progress}%</span>
        </div>
        <div style={s.progressTrack}>
          <div style={{ ...s.progressFill, width: `${progress}%`, background: barColor }} />
        </div>
        <span style={s.progressSub}>{progress}% TO GRADUATION</span>
      </div>

      {/* Stats row */}
      <div style={s.statsRow}>
        <div style={s.statCol}>
          <span style={s.statLabel}>MCAP</span>
          <span style={s.statVal}>{fmtMcap(token)}</span>
        </div>
        <div style={{ ...s.statCol, alignItems: 'flex-end' as const }}>
          <span style={s.statLabel}>LAUNCHED</span>
          <span style={s.statVal}>{token.createAt ? timeAgo(token.createAt) : '—'}</span>
        </div>
      </div>

      {/* TRADE button */}
      <Link href={`/farm/${token.mint}`} style={s.tradeBtn}>
        ⇄ TRADE
      </Link>
    </div>
  );
}

/* ── Skeleton card ────────────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <div style={{ ...s.card, gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#1a1a1a', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ height: '8px', background: '#1a1a1a', borderRadius: '4px', width: '60%', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: '6px', background: '#1a1a1a', borderRadius: '4px', width: '80%', animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
      </div>
      <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '2px', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ height: '36px', background: '#1a1a1a', borderRadius: '7px', animation: 'pulse 1.5s ease-in-out infinite' }} />
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */

export default function TokensPage() {
  const [tokens, setTokens] = useState<LaunchToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPlatformTokens();
      setTokens(data);
      setRefreshedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showSkeleton = loading && tokens.length === 0;
  const showGrid     = tokens.length > 0;
  const showEmpty    = !loading && tokens.length === 0 && !error;

  return (
    <main style={s.page}>

      {/* ── Sticky header ── */}
      <header style={s.header}>
        <Link href="/" style={s.logo}>
          BASED<span style={s.logoAccent}>FARMS</span>
        </Link>
        <nav style={s.headerNav}>
          <Link href="/tokens" style={s.navActive}>TOKENS</Link>
          <Link href="/launch" style={s.launchBtn}>+ LAUNCH</Link>
        </nav>
      </header>

      {/* ── Page title row ── */}
      <div style={s.titleRow}>
        <div>
          <h1 style={s.pageTitle}>◈ LIVE LAUNCHES</h1>
          <p style={s.pageSub}>Tokens launched on BASEDFARMS.fun</p>
          {refreshedAt && (
            <p style={s.refreshedAt}>
              Updated {refreshedAt.toLocaleTimeString()}
            </p>
          )}
        </div>
        <div style={s.titleActions}>
          <button
            onClick={load}
            disabled={loading}
            style={{ ...s.refreshBtn, opacity: loading ? 0.5 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? '◌' : '↺'} REFRESH
          </button>
          <Link href="/launch" style={s.launchCta}>+ LAUNCH YOUR TOKEN</Link>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={s.content}>

        {/* Error */}
        {error && (
          <div style={s.errorBox}>
            <span style={s.errorText}>⚠ {error}</span>
          </div>
        )}

        {/* Skeleton loading */}
        {showSkeleton && (
          <div style={s.grid}>
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Token grid */}
        {showGrid && (
          <div style={s.grid}>
            {tokens.map((t) => (
              <TokenCard key={t.poolId ?? t.mint} token={t} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {showEmpty && (
          <div style={s.emptyState}>
            <span style={{ fontSize: '48px', lineHeight: 1 }}>🌾</span>
            <div>
              <p style={s.emptyTitle}>No tokens launched yet.</p>
              <p style={s.emptySub}>Be the first.</p>
            </div>
            <Link href="/launch" style={s.emptyLaunchBtn}>
              + LAUNCH YOUR TOKEN
            </Link>
          </div>
        )}
      </div>

      <footer style={s.footer}>
        POWERED BY RAYDIUM LAUNCHLAB · BASEDFARMS.fun
      </footer>
    </main>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0a0a0a',
    color: '#e5e5e5',
    fontFamily: font,
    padding: '0 0 60px',
    boxSizing: 'border-box',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid #1a1a1a',
    background: 'rgba(10, 10, 10, 0.95)',
    backdropFilter: 'blur(10px)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  logo: {
    fontFamily: pressStart,
    fontSize: '11px',
    letterSpacing: '2px',
    color: '#ffffff',
    textDecoration: 'none',
  },
  logoAccent: { color: '#f97316' },
  headerNav: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  navActive: {
    fontFamily: font,
    fontSize: '12px',
    letterSpacing: '0.5px',
    color: '#f97316',
    textDecoration: 'none',
    fontWeight: '600',
  },
  launchBtn: {
    fontFamily: font,
    fontSize: '11px',
    letterSpacing: '0.5px',
    fontWeight: '600',
    padding: '8px 12px',
    background: '#f97316',
    borderRadius: '6px',
    color: '#000000',
    textDecoration: 'none',
  },

  // Title row
  titleRow: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px 16px 16px',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap',
  },
  pageTitle: {
    fontFamily: font,
    fontSize: '20px',
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: '1px',
    margin: 0,
  },
  pageSub: {
    fontFamily: font,
    fontSize: '12px',
    color: '#666666',
    letterSpacing: '0.3px',
    margin: '8px 0 0',
  },
  refreshedAt: {
    fontFamily: font,
    fontSize: '11px',
    color: '#444444',
    letterSpacing: '0.3px',
    margin: '4px 0 0',
  },
  titleActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  refreshBtn: {
    fontFamily: font,
    fontSize: '12px',
    letterSpacing: '0.3px',
    padding: '9px 12px',
    background: '#1a1a1a',
    border: '1px solid #333333',
    borderRadius: '6px',
    color: '#888888',
  },
  launchCta: {
    fontFamily: font,
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.3px',
    padding: '9px 14px',
    background: '#f97316',
    borderRadius: '6px',
    color: '#000000',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },

  // Content
  content: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '0 16px',
    boxSizing: 'border-box',
  },

  // Grid
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '12px',
  },

  // Token card
  card: {
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '12px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    boxSizing: 'border-box',
  },
  symbol: {
    fontFamily: pressStart,
    fontSize: '8px',
    color: '#f97316',
    letterSpacing: '1px',
  },
  tierBadge: {
    fontFamily: font,
    fontSize: '9px',
    letterSpacing: '0.3px',
    padding: '2px 5px',
    border: '1px solid',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    fontWeight: '600',
  },
  tokenName: {
    fontFamily: font,
    fontSize: '11px',
    color: '#888888',
    letterSpacing: '0.3px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusPill: {
    fontFamily: font,
    fontSize: '10px',
    letterSpacing: '0.3px',
    flexShrink: 0,
    paddingTop: '2px',
    fontWeight: '600',
  },

  // Progress
  progressSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontFamily: font,
    fontSize: '10px',
    color: '#555555',
    letterSpacing: '0.3px',
  },
  progressPct: {
    fontFamily: font,
    fontSize: '11px',
    color: '#e5e5e5',
    fontWeight: '600',
  },
  progressTrack: {
    height: '4px',
    background: '#1a1a1a',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.6s ease',
  },
  progressSub: {
    fontFamily: font,
    fontSize: '9px',
    color: '#444444',
    letterSpacing: '0.3px',
  },

  // Stats
  statsRow: {
    display: 'flex',
    justifyContent: 'space-between',
  },
  statCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  statLabel: {
    fontFamily: font,
    fontSize: '9px',
    color: '#555555',
    letterSpacing: '0.3px',
  },
  statVal: {
    fontFamily: font,
    fontSize: '11px',
    color: '#e5e5e5',
    fontWeight: '500',
  },

  // Trade button
  tradeBtn: {
    display: 'block',
    width: '100%',
    padding: '9px',
    background: '#f97316',
    borderRadius: '7px',
    color: '#000000',
    fontFamily: font,
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.5px',
    textAlign: 'center',
    textDecoration: 'none',
    boxSizing: 'border-box',
  },

  // Error
  errorBox: {
    padding: '14px 16px',
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid #ef4444',
    borderRadius: '10px',
    marginBottom: '16px',
  },
  errorText: {
    fontFamily: font,
    fontSize: '12px',
    color: '#ef4444',
    letterSpacing: '0.3px',
  },

  // Empty state
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
    padding: '80px 16px',
    textAlign: 'center',
  },
  emptyTitle: {
    fontFamily: font,
    fontSize: '14px',
    fontWeight: '600',
    color: '#888888',
    letterSpacing: '0.5px',
    margin: '0 0 8px',
  },
  emptySub: {
    fontFamily: font,
    fontSize: '12px',
    color: '#555555',
    letterSpacing: '0.5px',
    margin: 0,
  },
  emptyLaunchBtn: {
    fontFamily: font,
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.5px',
    padding: '14px 24px',
    background: '#f97316',
    borderRadius: '8px',
    color: '#000000',
    textDecoration: 'none',
  },

  // Footer
  footer: {
    fontFamily: font,
    fontSize: '11px',
    letterSpacing: '0.5px',
    color: '#333333',
    textAlign: 'center',
    marginTop: '40px',
    padding: '0 16px',
  },
};
