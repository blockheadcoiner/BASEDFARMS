'use client';

import Link from 'next/link';
import ConnectWalletButton from '@/components/ConnectWalletButton';

const font = 'var(--font-press-start), "Courier New", monospace';

const BGM_MINT = '3nZg1VZjT8qbeVPPKFmQmj6zbSw8D42RnxSeae3Qbonk';

type TickerEntry =
  | { kind: 'sep' }
  | { kind: 'text';  label: string; pink?: boolean }
  | { kind: 'logo';  symbol: string; symbolColor: string; label: string; pink?: boolean };

// One full pass of the ticker — duplicated below for seamless loop
const TICKER: TickerEntry[] = [
  { kind: 'text', label: '◈ BGM' },
  { kind: 'sep' },
  { kind: 'text', label: 'BASED GOOSE MONEY' },
  { kind: 'sep' },
  { kind: 'text', label: 'BASEDFARMS.fun' },
  { kind: 'sep' },
  { kind: 'logo', symbol: '✦', symbolColor: '#9945FF', label: 'POWERED BY RAYDIUM' },
  { kind: 'sep' },
  { kind: 'logo', symbol: '◎', symbolColor: '#9945FF', label: 'BUILT ON SOLANA' },
  { kind: 'sep' },
  { kind: 'text', label: '0.3% SWAP FEE' },
  { kind: 'sep' },
  { kind: 'text', label: 'BASED FARMS',          pink: true },
  { kind: 'sep' },
  { kind: 'text', label: 'LAUNCH YOUR TOKEN',    pink: true },
  { kind: 'sep' },
  { kind: 'text', label: 'LAUNCH YOUR FARM',     pink: true },
  { kind: 'sep' },
  { kind: 'text', label: 'BUILD YOUR COMMUNITY', pink: true },
  { kind: 'sep' },
];

function renderEntry(e: TickerEntry, key: string) {
  if (e.kind === 'sep') {
    return <span key={key} style={tickerSepStyle}>·</span>;
  }
  const color = e.pink ? '#db2777' : '#ffffff';
  if (e.kind === 'logo') {
    return (
      <span key={key} style={{ ...tickerItemStyle, color }}>
        <span style={{ color: e.symbolColor, marginRight: '5px' }}>{e.symbol}</span>
        {e.label}
      </span>
    );
  }
  return <span key={key} style={{ ...tickerItemStyle, color }}>{e.label}</span>;
}

// Defined outside component to avoid re-creation on every render
const tickerItemStyle: React.CSSProperties = {
  fontFamily: font,
  fontSize: '8px',
  letterSpacing: '1.5px',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};
const tickerSepStyle: React.CSSProperties = {
  color: '#3b0764',
  fontSize: '8px',
  fontFamily: font,
  flexShrink: 0,
  padding: '0 8px',
};


export default function HomePage() {
  return (
    <main style={styles.page}>

      {/* ── SCROLLING TICKER ── */}
      <div style={styles.tickerBar} aria-label="Live ticker">
        <div style={styles.tickerTrack}>
          {/* Render content twice — second copy keeps the scroll seamless */}
          {TICKER.map((e, i) => renderEntry(e, `a${i}`))}
          {TICKER.map((e, i) => renderEntry(e, `b${i}`))}
        </div>
      </div>

      {/* ── NAV ── */}
      <nav style={styles.nav}>
        <div style={styles.navLogo}>
          BASED<span style={styles.navAccent}>FARMS</span>
          <span style={styles.navDot}>.fun</span>
        </div>
        <div style={styles.navActions}>
          <ConnectWalletButton />
          <Link href="/tokens" style={styles.tokensBtn}>
            TOKENS
          </Link>
          <Link href="/launch" style={styles.launchBtn}>
            + LAUNCH TOKEN
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={styles.hero}>
        {/* Scanline texture */}
        <div style={styles.scanlines} aria-hidden />

        {/* Radial glow behind title */}
        <div style={styles.heroGlow} aria-hidden />

        <div style={styles.heroInner}>
          <div style={styles.heroBadge}>◈ SOLANA DEFI LAUNCHPAD</div>

          <h1 style={styles.heroTitle} className="hero-pink-neon">
            BASED<br />
            FARMS
          </h1>

          <p style={styles.heroTagline}>
            Your token.&nbsp;&nbsp;Your farm.&nbsp;&nbsp;Your rules.
          </p>

          <div style={styles.heroCtas}>
            <Link href={`/farm/${BGM_MINT}`} style={styles.ctaPrimary}>
              ◈ EXPLORE FARMS
            </Link>
            <Link href="/launch" style={styles.ctaSecondary}>
              + LAUNCH YOUR TOKEN
            </Link>
          </div>
        </div>
      </section>

      {/* ── FEATURED TOKEN ── */}
      <section style={styles.featuredSection}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>◈ FEATURED TOKEN</span>
          <span style={styles.sectionLive}>
            <span style={styles.liveDot} />
            LIVE
          </span>
        </div>

        <div style={styles.featuredCard}>
          {/* Animated border glow */}
          <div style={styles.cardGlowBorder} aria-hidden />

          <div style={styles.cardInner}>
            {/* Top row: avatar + identity + badge */}
            <div style={styles.cardTop}>
              <div style={styles.avatar}>
                <img
                  src="/tokens/bgm-logo.png"
                  alt="BGM"
                  style={styles.avatarImg}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    (e.currentTarget.nextSibling as HTMLElement | null)?.style.setProperty('display', 'block');
                  }}
                />
                <span style={styles.avatarFallback}>🪿</span>
              </div>

              <div style={styles.cardIdentity}>
                <div style={styles.cardSymbolRow}>
                  <span style={styles.cardSymbol}>$BGM</span>
                  <span style={styles.verifiedBadge}>✓ VERIFIED</span>
                </div>
                <span style={styles.cardName}>BASED GOOSE MONEY</span>
                <span style={styles.cardNetwork}>SOLANA MAINNET</span>
              </div>

              <div style={styles.farmSoonBadge}>
                <span style={styles.farmSoonTop}>🌾 FARM</span>
                <span style={styles.farmSoonBottom}>COMING SOON</span>
              </div>
            </div>

            {/* Stat strip */}
            <div style={styles.statStrip}>
              <div style={styles.stat}>
                <span style={styles.statLabel}>NETWORK</span>
                <span style={styles.statVal}>SOLANA</span>
              </div>
              <div style={styles.statDivider} />
              <div style={styles.stat}>
                <span style={styles.statLabel}>DEX</span>
                <span style={styles.statVal}>JUPITER V6</span>
              </div>
              <div style={styles.statDivider} />
              <div style={styles.stat}>
                <span style={styles.statLabel}>PLATFORM FEE</span>
                <span style={{ ...styles.statVal, color: '#e879f9' }}>0.3%</span>
              </div>
            </div>

            {/* Action buttons */}
            <div style={styles.cardActions}>
              <Link href={`/farm/${BGM_MINT}`} style={styles.actionPrimary}>
                ⇄ SWAP BGM
              </Link>
              <a
                href={`https://solscan.io/token/${BGM_MINT}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.actionSecondary}
              >
                SOLSCAN ↗
              </a>
              <a
                href={`https://birdeye.so/token/${BGM_MINT}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.actionSecondary}
              >
                BIRDEYE ↗
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={styles.howSection}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>◎ HOW IT WORKS</span>
        </div>

        <div style={styles.stepsGrid}>
          {[
            { num: '01', title: 'LAUNCH TOKEN', body: 'Deploy your token on Solana with one click. Set supply, name, and symbol.' },
            { num: '02', title: 'CREATE FARM',  body: 'Deploy a liquidity farm. Set reward rates and duration for your community.' },
            { num: '03', title: 'SWAP & EARN',  body: 'Trade via Jupiter routing. 0.3% fee split between the platform and farmers.' },
          ].map((step) => (
            <div key={step.num} style={styles.stepCard}>
              <span style={styles.stepNum}>{step.num}</span>
              <span style={styles.stepTitle}>{step.title}</span>
              <span style={styles.stepBody}>{step.body}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={styles.footer}>
        <div style={styles.footerLogo}>
          BASED<span style={{ color: '#e879f9' }}>FARMS</span>.fun
        </div>
        <p style={styles.footerLine}>BUILT ON SOLANA · POWERED BY RAYDIUM · 0.3% SWAP FEE</p>
        <p style={styles.footerLine}>NOT FINANCIAL ADVICE · DYOR · TRADE AT YOUR OWN RISK</p>
      </footer>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: font,
    fontSize: '10px',
    background: '#0d0015',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: '#c084fc',
    overflowX: 'hidden',
  },

  // Ticker
  tickerBar: {
    width: '100%',
    background: 'rgba(15, 0, 30, 0.85)',
    borderBottom: '1px solid #3b0764',
    overflow: 'hidden',
    padding: '9px 0',
  },
  tickerTrack: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0',
    animation: 'ticker 45s linear infinite',
    whiteSpace: 'nowrap',
  },

  // Nav
  nav: {
    width: '100%',
    maxWidth: '600px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 16px 12px',
    boxSizing: 'border-box',
  },
  navActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'nowrap' as const,
  },
  navLogo: {
    fontSize: '13px',
    color: '#f0abfc',
    letterSpacing: '2px',
    textShadow: '0 0 16px rgba(240, 171, 252, 0.4)',
    textDecoration: 'none',
  },
  navAccent: { color: '#e879f9' },
  navDot: { color: '#6d28d9', fontSize: '10px' },
  tokensBtn: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    padding: '10px 12px',
    background: 'transparent',
    border: '1px solid #3b0764',
    borderRadius: '6px',
    color: '#a855f7',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    display: 'inline-block',
  },
  launchBtn: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    padding: '10px 14px',
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    textDecoration: 'none',
    boxShadow: '0 0 14px rgba(168, 85, 247, 0.35)',
    whiteSpace: 'nowrap',
    display: 'inline-block',
  },

  // Hero
  hero: {
    width: '100%',
    maxWidth: '600px',
    position: 'relative',
    padding: '40px 16px 52px',
    boxSizing: 'border-box',
    textAlign: 'center',
    overflow: 'hidden',
  },
  scanlines: {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(124,58,237,0.03) 2px, rgba(124,58,237,0.03) 4px)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  heroGlow: {
    position: 'absolute',
    top: '20%',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '300px',
    height: '300px',
    background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  heroInner: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
  },
  heroBadge: {
    display: 'inline-block',
    background: 'rgba(88, 28, 135, 0.3)',
    border: '1px solid #4c1d95',
    borderRadius: '20px',
    padding: '5px 16px',
    fontSize: '8px',
    color: '#a855f7',
    letterSpacing: '2px',
  },
  heroTitle: {
    margin: 0,
    fontSize: 'clamp(36px, 12vw, 72px)',
    lineHeight: 1.1,
    letterSpacing: '4px',
    fontFamily: font,
    fontWeight: 400,
  },
  heroTagline: {
    margin: 0,
    fontSize: 'clamp(7px, 2.2vw, 11px)',
    color: '#6d28d9',
    letterSpacing: '3px',
    lineHeight: 2.2,
    fontFamily: font,
  },
  heroCtas: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: '8px',
  },
  ctaPrimary: {
    fontFamily: font,
    fontSize: '10px',
    letterSpacing: '2px',
    padding: '14px 22px',
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    borderRadius: '8px',
    color: '#fff',
    textDecoration: 'none',
    boxShadow: '0 0 20px rgba(168, 85, 247, 0.4)',
    display: 'inline-block',
  },
  ctaSecondary: {
    fontFamily: font,
    fontSize: '10px',
    letterSpacing: '2px',
    padding: '13px 22px',
    background: 'transparent',
    border: '1px solid #7c3aed',
    borderRadius: '8px',
    color: '#a855f7',
    textDecoration: 'none',
    display: 'inline-block',
  },
  ctaLaunch: {
    fontFamily: font,
    fontSize: '11px',
    letterSpacing: '3px',
    padding: '15px 22px',
    background: 'linear-gradient(135deg, #db2777, #9d174d)',
    borderRadius: '8px',
    color: '#fff',
    textDecoration: 'none',
    boxShadow: '0 0 24px rgba(219, 39, 119, 0.45)',
    display: 'block',
    textAlign: 'center' as const,
    width: '100%',
    boxSizing: 'border-box' as const,
  },

  // Featured section
  featuredSection: {
    width: '100%',
    maxWidth: '600px',
    padding: '0 16px 32px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#a855f7',
    fontSize: '11px',
    letterSpacing: '2px',
    textShadow: '0 0 10px rgba(168, 85, 247, 0.4)',
  },
  sectionLive: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#4c1d95',
    fontSize: '8px',
    letterSpacing: '2px',
  },
  liveDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#e879f9',
    boxShadow: '0 0 8px rgba(232, 121, 249, 0.8)',
    display: 'inline-block',
    animation: 'pulse 2s ease-in-out infinite',
  },

  // Card
  featuredCard: {
    position: 'relative',
    borderRadius: '14px',
    overflow: 'hidden',
    animation: 'border-glow 4s ease-in-out infinite',
    border: '1px solid #7c3aed',
  },
  cardGlowBorder: {
    position: 'absolute',
    inset: 0,
    borderRadius: '14px',
    background: 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(219,39,119,0.04) 100%)',
    pointerEvents: 'none',
  },
  cardInner: {
    position: 'relative',
    zIndex: 1,
    background: 'linear-gradient(160deg, #0d0015 0%, #11001e 60%, #0a001a 100%)',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
  },
  avatar: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    overflow: 'hidden',
    flexShrink: 0,
    border: '1px solid #4c1d95',
    background: '#000',
    boxSizing: 'border-box',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    objectPosition: 'center',
    display: 'block',
    padding: '4px',
  },
  avatarFallback: {
    fontSize: '28px',
    lineHeight: 1,
    display: 'none',
  },
  cardIdentity: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    minWidth: 0,
  },
  cardSymbolRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  cardSymbol: {
    color: '#e879f9',
    fontSize: '14px',
    letterSpacing: '1px',
    textShadow: '0 0 10px rgba(232, 121, 249, 0.4)',
  },
  verifiedBadge: {
    background: 'rgba(124, 58, 237, 0.2)',
    border: '1px solid #7c3aed',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '7px',
    color: '#a855f7',
    letterSpacing: '1px',
  },
  cardName: {
    color: '#c084fc',
    fontSize: '9px',
    letterSpacing: '2px',
  },
  cardNetwork: {
    color: '#4c1d95',
    fontSize: '7px',
    letterSpacing: '2px',
  },
  farmSoonBadge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '3px',
    background: 'rgba(219, 39, 119, 0.1)',
    border: '1px solid #db2777',
    borderRadius: '8px',
    padding: '6px 10px',
    flexShrink: 0,
    boxShadow: '0 0 12px rgba(219, 39, 119, 0.15)',
  },
  farmSoonTop: {
    color: '#f472b6',
    fontSize: '9px',
    letterSpacing: '1px',
  },
  farmSoonBottom: {
    color: '#db2777',
    fontSize: '6px',
    letterSpacing: '1px',
    whiteSpace: 'nowrap',
  },

  // Stats
  statStrip: {
    display: 'flex',
    background: 'rgba(15, 0, 30, 0.5)',
    border: '1px solid #2d0052',
    borderRadius: '8px',
    overflow: 'hidden',
    flexWrap: 'wrap',
  },
  stat: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    padding: '12px 8px',
    minWidth: '80px',
  },
  statLabel: {
    color: '#3b0764',
    fontSize: '6px',
    letterSpacing: '2px',
    textAlign: 'center',
  },
  statVal: {
    color: '#a855f7',
    fontSize: '8px',
    letterSpacing: '1px',
    textAlign: 'center',
  },
  statDivider: {
    width: '1px',
    background: '#2d0052',
    margin: '8px 0',
    alignSelf: 'stretch',
  },

  // Card actions
  cardActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  actionPrimary: {
    flex: 1,
    fontFamily: font,
    fontSize: '10px',
    letterSpacing: '2px',
    padding: '13px 16px',
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    borderRadius: '8px',
    color: '#fff',
    textDecoration: 'none',
    textAlign: 'center',
    boxShadow: '0 0 16px rgba(168, 85, 247, 0.35)',
    display: 'inline-block',
    minWidth: '120px',
  },
  actionSecondary: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    padding: '12px 14px',
    background: 'transparent',
    border: '1px solid #3b0764',
    borderRadius: '8px',
    color: '#6d28d9',
    textDecoration: 'none',
    display: 'inline-block',
    whiteSpace: 'nowrap',
  },

  // How it works
  howSection: {
    width: '100%',
    maxWidth: '600px',
    padding: '8px 16px 40px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  stepsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '12px',
  },
  stepCard: {
    background: 'rgba(88, 28, 135, 0.07)',
    border: '1px solid #2d0052',
    borderRadius: '10px',
    padding: '16px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  stepNum: {
    color: '#3b0764',
    fontSize: '20px',
    letterSpacing: '0',
    fontFamily: font,
  },
  stepTitle: {
    color: '#a855f7',
    fontSize: '9px',
    letterSpacing: '2px',
  },
  stepBody: {
    color: '#4c1d95',
    fontSize: '7px',
    letterSpacing: '1px',
    lineHeight: 2,
  },

  // Footer
  footer: {
    width: '100%',
    maxWidth: '600px',
    padding: '24px 16px 32px',
    boxSizing: 'border-box',
    borderTop: '1px solid #1e0035',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
  footerLogo: {
    fontSize: '12px',
    color: '#f0abfc',
    letterSpacing: '2px',
    textShadow: '0 0 12px rgba(240, 171, 252, 0.3)',
  },
  footerLine: {
    margin: 0,
    color: '#2d0052',
    fontSize: '7px',
    letterSpacing: '1px',
    textAlign: 'center',
  },
};
