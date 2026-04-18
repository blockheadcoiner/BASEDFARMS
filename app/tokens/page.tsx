'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const font = 'var(--font-press-start), "Courier New", monospace';
const PLATFORM_ID = '32SyS4SyyNK0AERNMk9vLjSdrJ9mUXrNkD5wUMASqHw4';

/* ── API types ────────────────────────────────────────────────────────────── */

interface LaunchToken {
  poolId?: string;
  mintA: string;
  name: string;
  symbol: string;
  uri?: string;
  status?: number;           // 0=trading 1=migrating 2=graduated
  createTime?: number;       // unix seconds or ms — handle both
  totalSellA?: string;
  totalFundRaisingB?: string;
  currentBaseAmount?: string;
  currentQuoteAmount?: string;
  price?: string | number;
  marketCap?: string | number;
}

async function fetchPlatformTokens(): Promise<LaunchToken[]> {
  const res = await fetch(
    `https://api-v3.raydium.io/launchpad/token/list` +
    `?platformId=${PLATFORM_ID}&page=1&pageSize=20`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  const json = await res.json() as {
    success: boolean;
    data?: { count?: number; data?: LaunchToken[]; rows?: LaunchToken[] } | LaunchToken[];
  };
  if (!json.success) throw new Error('Raydium API returned success: false');
  if (Array.isArray(json.data)) return json.data;
  const nested = json.data as { data?: LaunchToken[]; rows?: LaunchToken[] } | undefined;
  return nested?.data ?? nested?.rows ?? [];
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function timeAgo(ts: number): string {
  const now = Date.now();
  const ms = ts > 1e12 ? ts : ts * 1000;
  const diff = now - ms;
  if (diff < 60_000)       return 'just now';
  if (diff < 3_600_000)    return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)   return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function curveProgress(t: LaunchToken): number {
  try {
    const raised = Number(t.currentQuoteAmount ?? 0);
    const target = Number(t.totalFundRaisingB ?? 0);
    if (target > 0 && raised >= 0) return Math.min(100, Math.round((raised / target) * 100));
  } catch { /* */ }
  return 0;
}

function fmtMcap(t: LaunchToken): string {
  if (!t.marketCap) return '—';
  const n = Number(t.marketCap);
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M SOL`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K SOL`;
  return `${n.toFixed(2)} SOL`;
}

function statusInfo(status?: number) {
  if (status === 2) return { text: '✓ GRAD',    color: '#22c55e' };
  if (status === 1) return { text: '⟳ MIGRATE', color: '#f59e0b' };
  return                    { text: '● LIVE',    color: '#db2777' };
}

function basedTier(name: string, symbol: string) {
  const nb = /based/i.test(name);
  const sb = /based/i.test(symbol);
  if (nb && sb) return { label: 'MAX BASED', color: '#f59e0b' };
  if (nb || sb) return { label: 'BASED',     color: '#22c55e' };
  return null;
}

/** Deterministic hue from symbol string */
function symbolHue(symbol: string) {
  return symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
}

/* ── Token Image ─────────────────────────────────────────────────────────── */

function TokenImage({ uri, symbol, size }: { uri?: string; symbol: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!uri) return;
    // Direct image extension → use as-is
    if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(uri)) {
      setSrc(uri);
      return;
    }
    // Metadata JSON → fetch image field
    let cancelled = false;
    fetch(uri)
      .then((r) => r.json())
      .then((meta: { image?: string }) => {
        if (!cancelled && meta.image) setSrc(meta.image);
      })
      .catch(() => { /* fallback avatar */ });
    return () => { cancelled = true; };
  }, [uri]);

  const hue = symbolHue(symbol);
  const letter = symbol.charAt(0).toUpperCase();

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={symbol}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block', flexShrink: 0 }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `hsl(${hue},55%,16%)`,
      border: `1px solid hsl(${hue},55%,30%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: font,
      fontSize: `${Math.floor(size * 0.38)}px`,
      color: `hsl(${hue},70%,65%)`,
    }}>
      {letter}
    </div>
  );
}

/* ── Token Card ──────────────────────────────────────────────────────────── */

function TokenCard({ token }: { token: LaunchToken }) {
  const progress = curveProgress(token);
  const sl = statusInfo(token.status);
  const tier = basedTier(token.name, token.symbol);
  const barColor = progress >= 90
    ? '#22c55e'
    : `linear-gradient(90deg, #7c3aed, #db2777)`;

  return (
    <div style={s.card}>
      {/* Header row: logo + name/symbol + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <TokenImage uri={token.uri} symbol={token.symbol} size={40} />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {/* Symbol + tier badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
            <span style={s.symbol}>${token.symbol}</span>
            {tier && (
              <span style={{ ...s.tierBadge, color: tier.color, borderColor: tier.color, background: `${tier.color}1a` }}>
                ◈ {tier.label}
              </span>
            )}
          </div>
          {/* Name */}
          <span style={s.tokenName}>{token.name}</span>
        </div>

        {/* Status pill */}
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
          <span style={s.statVal}>{token.createTime ? timeAgo(token.createTime) : '—'}</span>
        </div>
      </div>

      {/* TRADE button */}
      <Link href={`/farm/${token.mintA}`} style={s.tradeBtn}>
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
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#1e0035', flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ height: '8px', background: '#1e0035', borderRadius: '4px', width: '60%', animation: 'pulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: '6px', background: '#1e0035', borderRadius: '4px', width: '80%', animation: 'pulse 1.5s ease-in-out infinite' }} />
        </div>
      </div>
      <div style={{ height: '4px', background: '#1e0035', borderRadius: '2px', animation: 'pulse 1.5s ease-in-out infinite' }} />
      <div style={{ height: '36px', background: '#1e0035', borderRadius: '7px', animation: 'pulse 1.5s ease-in-out infinite' }} />
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
              <TokenCard key={t.poolId ?? t.mintA} token={t} />
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
    background: '#0d0015',
    color: '#c084fc',
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
    borderBottom: '1px solid #1e0035',
    background: 'rgba(13, 0, 21, 0.95)',
    backdropFilter: 'blur(10px)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  logo: {
    fontFamily: font,
    fontSize: '11px',
    letterSpacing: '2px',
    color: '#c084fc',
    textDecoration: 'none',
    textShadow: '0 0 10px rgba(192, 132, 252, 0.4)',
  },
  logoAccent: { color: '#db2777' },
  headerNav: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  navActive: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    color: '#e879f9',
    textDecoration: 'none',
    textShadow: '0 0 8px rgba(232,121,249,0.5)',
  },
  launchBtn: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    padding: '8px 12px',
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    borderRadius: '6px',
    color: '#fff',
    textDecoration: 'none',
    boxShadow: '0 0 12px rgba(168, 85, 247, 0.3)',
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
    fontSize: '14px',
    color: '#e879f9',
    textShadow: '0 0 16px rgba(232,121,249,0.6)',
    letterSpacing: '3px',
    margin: 0,
    fontWeight: 400,
  },
  pageSub: {
    fontFamily: font,
    fontSize: '6px',
    color: '#6d28d9',
    letterSpacing: '1.5px',
    margin: '8px 0 0',
  },
  refreshedAt: {
    fontFamily: font,
    fontSize: '5px',
    color: '#3b0764',
    letterSpacing: '1px',
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
    fontSize: '7px',
    letterSpacing: '1px',
    padding: '9px 12px',
    background: 'rgba(88, 28, 135, 0.2)',
    border: '1px solid #3b0764',
    borderRadius: '6px',
    color: '#c084fc',
  },
  launchCta: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    padding: '9px 14px',
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    borderRadius: '6px',
    color: '#fff',
    textDecoration: 'none',
    boxShadow: '0 0 14px rgba(219, 39, 119, 0.35)',
    whiteSpace: 'nowrap',
  },

  // Content
  content: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '0 16px',
    boxSizing: 'border-box',
  },

  // Grid: auto-fill, 2 cols on mobile (min 160px), 3-4 on wider screens
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '12px',
  },

  // Token card
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid #3b0764',
    borderRadius: '12px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    boxSizing: 'border-box',
    boxShadow: '0 0 20px rgba(124, 58, 237, 0.1), inset 0 0 20px rgba(88, 28, 135, 0.03)',
  },
  symbol: {
    fontFamily: font,
    fontSize: '8px',
    color: '#e879f9',
    letterSpacing: '1px',
    textShadow: '0 0 8px rgba(232,121,249,0.4)',
  },
  tierBadge: {
    fontFamily: font,
    fontSize: '5px',
    letterSpacing: '0.5px',
    padding: '2px 5px',
    border: '1px solid',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
  },
  tokenName: {
    fontFamily: font,
    fontSize: '6px',
    color: '#c084fc',
    letterSpacing: '0.8px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusPill: {
    fontFamily: font,
    fontSize: '5px',
    letterSpacing: '0.5px',
    flexShrink: 0,
    paddingTop: '2px',
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
    fontSize: '5px',
    color: '#4c1d95',
    letterSpacing: '1px',
  },
  progressPct: {
    fontFamily: font,
    fontSize: '6px',
    color: '#a855f7',
  },
  progressTrack: {
    height: '4px',
    background: '#1e0035',
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
    fontSize: '5px',
    color: '#3b0764',
    letterSpacing: '0.5px',
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
    fontSize: '5px',
    color: '#3b0764',
    letterSpacing: '1px',
  },
  statVal: {
    fontFamily: font,
    fontSize: '6px',
    color: '#c084fc',
  },

  // Trade button
  tradeBtn: {
    display: 'block',
    width: '100%',
    padding: '9px',
    background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
    borderRadius: '7px',
    color: '#ffffff',
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    textAlign: 'center',
    textDecoration: 'none',
    boxSizing: 'border-box',
    boxShadow: '0 0 12px rgba(219, 39, 119, 0.25)',
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
    fontSize: '7px',
    color: '#ef4444',
    letterSpacing: '1px',
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
    fontSize: '9px',
    color: '#6d28d9',
    letterSpacing: '2px',
    margin: '0 0 8px',
  },
  emptySub: {
    fontFamily: font,
    fontSize: '7px',
    color: '#3b0764',
    letterSpacing: '1.5px',
    margin: 0,
  },
  emptyLaunchBtn: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '2px',
    padding: '14px 24px',
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    borderRadius: '8px',
    color: '#fff',
    textDecoration: 'none',
    boxShadow: '0 0 20px rgba(219, 39, 119, 0.4)',
  },

  // Footer
  footer: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '1.5px',
    color: '#1e0035',
    textAlign: 'center',
    marginTop: '40px',
    padding: '0 16px',
  },
};
