'use client';

import Link from 'next/link';
import ConnectWalletButton from '@/components/ConnectWalletButton';

const pressStart = 'var(--font-press-start), "Courier New", monospace';
const font = "'Geist', -apple-system, BlinkMacSystemFont, sans-serif";

const BGM_MINT = '3nZg1VZjT8qbeVPPKFmQmj6zbSw8D42RnxSeae3Qbonk';

type TickerEntry =
  | { kind: 'sep' }
  | { kind: 'text';  label: string; accent?: boolean }
  | { kind: 'logo';  symbol: string; symbolColor: string; label: string; accent?: boolean };

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
  { kind: 'text', label: 'BASED FARMS',          accent: true },
  { kind: 'sep' },
  { kind: 'text', label: 'LAUNCH YOUR TOKEN',    accent: true },
  { kind: 'sep' },
  { kind: 'text', label: 'LAUNCH YOUR FARM',     accent: true },
  { kind: 'sep' },
  { kind: 'text', label: 'BUILD YOUR COMMUNITY', accent: true },
  { kind: 'sep' },
];

function renderEntry(e: TickerEntry, key: string) {
  if (e.kind === 'sep') {
    return <span key={key} style={tickerSepStyle}>·</span>;
  }
  const color = e.accent ? '#f97316' : '#888888';
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

const tickerItemStyle: React.CSSProperties = {
  fontFamily: pressStart,
  fontSize: '8px',
  letterSpacing: '1.5px',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};
const tickerSepStyle: React.CSSProperties = {
  color: '#333333',
  fontSize: '8px',
  fontFamily: pressStart,
  flexShrink: 0,
  padding: '0 8px',
};


export default function HomePage() {
  return (
    <main style={styles.page}>

      {/* ── SCROLLING TICKER ── */}
      <div style={styles.tickerBar} aria-label="Live ticker">
        <div style={styles.tickerTrack}>
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
        <div style={styles.heroInner}>
          <div style={styles.heroBadge}>◈ SOLANA DEFI LAUNCHPAD</div>

          <h1 style={styles.heroTitle}>
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
                <span style={styles.statVal}>RAYDIUM</span>
              </div>
              <div style={styles.statDivider} />
              <div style={styles.stat}>
                <span style={styles.statLabel}>PLATFORM FEE</span>
                <span style={{ ...styles.statVal, color: '#f97316' }}>0.3%</span>
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
            { num: '01', title: 'LAUNCH TOKEN',        body: 'Deploy your token with custom bonding curve and Based Score. Built on Raydium LaunchLab.' },
            { num: '02', title: 'GRADUATE TO RAYDIUM', body: 'When your bonding curve hits target SOL, your token auto-graduates to a Raydium pool. Deep liquidity. Immediate trading.' },
            { num: '03', title: 'FARM YIELD',          body: 'Post-graduation your token unlocks Raydium permissionless farms. Stakers earn rewards. Creators earn fees forever.' },
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
          BASED<span style={{ color: '#f97316' }}>FARMS</span>.fun
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
    background: '#0a0a0a',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: '#e5e5e5',
    overflowX: 'hidden',
  },

  // Ticker
  tickerBar: {
    width: '100%',
    background: '#111111',
    borderBottom: '1px solid #1a1a1a',
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
    fontFamily: pressStart,
    fontSize: '13px',
    color: '#ffffff',
    letterSpacing: '2px',
    textDecoration: 'none',
  },
  navAccent: { color: '#f97316' },
  navDot: { color: '#555555', fontSize: '10px' },
  tokensBtn: {
    fontFamily: font,
    fontSize: '11px',
    letterSpacing: '0.5px',
    padding: '8px 12px',
    background: 'transparent',
    border: '1px solid #333333',
    borderRadius: '6px',
    color: '#888888',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    display: 'inline-block',
  },
  launchBtn: {
    fontFamily: font,
    fontSize: '11px',
    letterSpacing: '0.5px',
    padding: '8px 14px',
    background: '#f97316',
    border: 'none',
    borderRadius: '6px',
    color: '#000000',
    fontWeight: '600',
    cursor: 'pointer',
    textDecoration: 'none',
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
  },
  heroInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
  },
  heroBadge: {
    display: 'inline-block',
    background: '#1a1a1a',
    border: '1px solid #333333',
    borderRadius: '20px',
    padding: '5px 16px',
    fontSize: '11px',
    color: '#888888',
    letterSpacing: '1px',
  },
  heroTitle: {
    margin: 0,
    fontSize: 'clamp(36px, 12vw, 72px)',
    lineHeight: 1.1,
    letterSpacing: '4px',
    fontFamily: pressStart,
    fontWeight: 400,
    color: '#ffffff',
  },
  heroTagline: {
    margin: 0,
    fontSize: 'clamp(11px, 2.2vw, 13px)',
    color: '#666666',
    letterSpacing: '2px',
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
    fontSize: '12px',
    letterSpacing: '1px',
    fontWeight: '600',
    padding: '14px 22px',
    background: '#f97316',
    borderRadius: '8px',
    color: '#000000',
    textDecoration: 'none',
    display: 'inline-block',
  },
  ctaSecondary: {
    fontFamily: font,
    fontSize: '12px',
    letterSpacing: '1px',
    padding: '13px 22px',
    background: 'transparent',
    border: '1px solid #333333',
    borderRadius: '8px',
    color: '#888888',
    textDecoration: 'none',
    display: 'inline-block',
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
    color: '#e5e5e5',
    fontSize: '12px',
    letterSpacing: '1.5px',
    fontFamily: font,
  },
  sectionLive: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: '#555555',
    fontSize: '11px',
    letterSpacing: '1px',
  },
  liveDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#f97316',
    display: 'inline-block',
    animation: 'pulse 2s ease-in-out infinite',
  },

  // Card
  featuredCard: {
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #222222',
  },
  cardInner: {
    background: '#111111',
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
    border: '1px solid #222222',
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
    fontFamily: pressStart,
    color: '#f97316',
    fontSize: '14px',
    letterSpacing: '1px',
  },
  verifiedBadge: {
    background: '#1a1a1a',
    border: '1px solid #333333',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '10px',
    color: '#888888',
    letterSpacing: '0.5px',
  },
  cardName: {
    color: '#e5e5e5',
    fontSize: '11px',
    letterSpacing: '1px',
  },
  cardNetwork: {
    color: '#555555',
    fontSize: '10px',
    letterSpacing: '1px',
  },
  farmSoonBadge: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '3px',
    background: 'rgba(249, 115, 22, 0.08)',
    border: '1px solid rgba(249, 115, 22, 0.3)',
    borderRadius: '8px',
    padding: '6px 10px',
    flexShrink: 0,
  },
  farmSoonTop: {
    color: '#f97316',
    fontSize: '10px',
    letterSpacing: '0.5px',
  },
  farmSoonBottom: {
    color: '#888888',
    fontSize: '9px',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
  },

  // Stats
  statStrip: {
    display: 'flex',
    background: '#0f0f0f',
    border: '1px solid #1a1a1a',
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
    color: '#555555',
    fontSize: '9px',
    letterSpacing: '1px',
    textAlign: 'center',
  },
  statVal: {
    color: '#e5e5e5',
    fontSize: '10px',
    letterSpacing: '0.5px',
    textAlign: 'center',
  },
  statDivider: {
    width: '1px',
    background: '#1a1a1a',
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
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '1px',
    padding: '13px 16px',
    background: '#f97316',
    borderRadius: '8px',
    color: '#000000',
    textDecoration: 'none',
    textAlign: 'center',
    display: 'inline-block',
    minWidth: '120px',
  },
  actionSecondary: {
    fontFamily: font,
    fontSize: '11px',
    letterSpacing: '0.5px',
    padding: '12px 14px',
    background: 'transparent',
    border: '1px solid #222222',
    borderRadius: '8px',
    color: '#555555',
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
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '10px',
    padding: '16px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  stepNum: {
    color: '#333333',
    fontSize: '20px',
    letterSpacing: '0',
    fontFamily: pressStart,
  },
  stepTitle: {
    color: '#f97316',
    fontSize: '11px',
    letterSpacing: '1px',
    fontFamily: font,
    fontWeight: '600',
  },
  stepBody: {
    color: '#666666',
    fontSize: '11px',
    letterSpacing: '0.3px',
    lineHeight: 1.7,
    fontFamily: font,
  },

  // Footer
  footer: {
    width: '100%',
    maxWidth: '600px',
    padding: '24px 16px 32px',
    boxSizing: 'border-box',
    borderTop: '1px solid #1a1a1a',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
  footerLogo: {
    fontFamily: pressStart,
    fontSize: '12px',
    color: '#ffffff',
    letterSpacing: '2px',
  },
  footerLine: {
    margin: 0,
    color: '#444444',
    fontSize: '10px',
    letterSpacing: '0.5px',
    textAlign: 'center',
    fontFamily: font,
  },
};
