'use client';

import { useState, use } from 'react';
import Link from 'next/link';
import SwapWidget from '@/components/swap/SwapWidget';
import FarmsTab from '@/components/farms/FarmsTab';

const font = 'var(--font-press-start), "Courier New", monospace';

type Tab = 'swap' | 'farms' | 'info';

const TABS: { id: Tab; label: string }[] = [
  { id: 'swap', label: '⇄ SWAP' },
  { id: 'farms', label: '◈ FARMS' },
  { id: 'info', label: '◎ INFO' },
];

interface Props {
  params: Promise<{ tokenMint: string }>;
}

export default function FarmPage({ params }: Props) {
  const { tokenMint } = use(params);
  const [activeTab, setActiveTab] = useState<Tab>('swap');
  const [lastTx, setLastTx] = useState<string | null>(null);

  const shortMint = `${tokenMint.slice(0, 4)}…${tokenMint.slice(-4)}`;

  return (
    <main style={styles.page}>
      {/* Page header */}
      <header style={styles.header}>
        <div style={styles.logo}>BASED<span style={styles.logoAccent}>FARMS</span></div>
        <div style={styles.headerRight}>
          <div style={styles.mintPill}>{shortMint}</div>
          <Link href="/launch" style={styles.launchBtn}>+ LAUNCH</Link>
        </div>
      </header>

      {/* Tab bar */}
      <nav style={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...styles.tabBtn,
              ...(activeTab === tab.id ? styles.tabBtnActive : styles.tabBtnInactive),
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.id === 'swap'
              ? <span className="hero-gradient-text">{tab.label}</span>
              : tab.label
            }
            {activeTab === tab.id && <span style={styles.tabUnderline} />}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div style={styles.content}>

        {/* ── SWAP TAB ── */}
        {activeTab === 'swap' && (
          <div style={styles.swapLayout}>
            {/* Price chart placeholder */}
            <div style={styles.chartCard}>
              <div style={styles.chartHeader}>
                <span style={styles.chartTitle}>PRICE CHART</span>
                <span style={styles.chartBadge}>COMING SOON</span>
              </div>
              <div style={styles.chartBody}>
                {/* Fake sparkline */}
                <svg viewBox="0 0 300 80" style={styles.sparkline} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0,60 C30,55 50,40 80,42 S120,30 150,28 S200,35 230,20 S270,15 300,10"
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M0,60 C30,55 50,40 80,42 S120,30 150,28 S200,35 230,20 S270,15 300,10 L300,80 L0,80 Z"
                    fill="url(#chartGrad)"
                  />
                </svg>
                <div style={styles.chartOverlay}>
                  <span style={styles.chartOverlayText}>CONNECT DATA SOURCE TO ACTIVATE</span>
                </div>
              </div>
              <div style={styles.chartFooter}>
                {['1H', '4H', '1D', '1W'].map((tf) => (
                  <button key={tf} style={styles.tfBtn}>{tf}</button>
                ))}
              </div>
            </div>

            {/* Swap widget */}
            <div style={styles.widgetWrap}>
              <SwapWidget
                tokenMint={tokenMint}
                tokenSymbol={shortMint}
                onSwapComplete={(sig) => setLastTx(sig)}
              />
            </div>

            {/* Last tx banner */}
            {lastTx && (
              <div style={styles.txBanner}>
                <span style={styles.txBannerLabel}>LAST TX</span>
                <a
                  href={`https://solscan.io/tx/${lastTx}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.txBannerLink}
                >
                  {lastTx.slice(0, 8)}…{lastTx.slice(-8)} ↗
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── FARMS TAB ── */}
        {activeTab === 'farms' && (
          <FarmsTab tokenMint={tokenMint} />
        )}

        {/* ── INFO TAB ── */}
        {activeTab === 'info' && (
          <div style={styles.infoCard}>
            <div style={styles.infoTitle}>TOKEN INFO</div>

            <div style={styles.infoRow}>
              <span style={styles.infoKey}>MINT ADDRESS</span>
              <span style={styles.infoVal}>{tokenMint}</span>
            </div>

            <div style={styles.infoRow}>
              <span style={styles.infoKey}>NETWORK</span>
              <span style={styles.infoVal}>SOLANA MAINNET</span>
            </div>

            <div style={styles.infoRow}>
              <span style={styles.infoKey}>DEX ROUTER</span>
              <span style={styles.infoVal}>RAYDIUM LAUNCHLAB</span>
            </div>

            <div style={styles.infoRow}>
              <span style={styles.infoKey}>PLATFORM FEE</span>
              <span style={{ ...styles.infoVal, color: '#e879f9' }}>0.3%</span>
            </div>

            <div style={styles.infoLinks}>
              <a
                href={`https://solscan.io/token/${tokenMint}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.infoLink}
              >
                VIEW ON SOLSCAN ↗
              </a>
              <a
                href={`https://birdeye.so/token/${tokenMint}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.infoLink}
              >
                VIEW ON BIRDEYE ↗
              </a>
              <a
                href={`https://dexscreener.com/solana/${tokenMint}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.infoLink}
              >
                VIEW ON DEXSCREENER ↗
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={styles.footer}>
        BASEDFARMS.fun · BUILT ON SOLANA · POWERED BY RAYDIUM
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
  },

  // Header
  header: {
    width: '100%',
    maxWidth: '480px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 16px 12px',
    boxSizing: 'border-box',
  },
  logo: {
    fontSize: '14px',
    color: '#f0abfc',
    letterSpacing: '2px',
    textShadow: '0 0 16px rgba(240, 171, 252, 0.5)',
  },
  logoAccent: {
    color: '#e879f9',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  mintPill: {
    background: 'rgba(88, 28, 135, 0.3)',
    border: '1px solid #4c1d95',
    borderRadius: '20px',
    padding: '4px 10px',
    fontSize: '8px',
    color: '#a855f7',
    letterSpacing: '1px',
  },
  launchBtn: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    padding: '5px 10px',
    background: 'linear-gradient(135deg, #db2777, #9d174d)',
    border: 'none',
    borderRadius: '20px',
    color: '#fff',
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
    boxShadow: '0 0 10px rgba(219, 39, 119, 0.35)',
    display: 'inline-block',
  },

  // Tabs
  tabBar: {
    width: '100%',
    maxWidth: '480px',
    display: 'flex',
    borderBottom: '1px solid #3b0764',
    padding: '0 16px',
    boxSizing: 'border-box',
    gap: '4px',
  },
  tabBtn: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    fontFamily: font,
    fontSize: '9px',
    letterSpacing: '1px',
    padding: '12px 4px 10px',
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    transition: 'color 0.15s ease',
  },
  tabBtnActive: {
    color: '#e879f9',
    textShadow: '0 0 10px rgba(232, 121, 249, 0.5)',
  },
  tabBtnInactive: {
    color: '#4c1d95',
  },
  tabUnderline: {
    position: 'absolute',
    bottom: '-1px',
    left: '10%',
    width: '80%',
    height: '2px',
    background: 'linear-gradient(90deg, #7c3aed, #db2777)',
    borderRadius: '2px',
    boxShadow: '0 0 8px rgba(219, 39, 119, 0.6)',
  },

  // Content
  content: {
    width: '100%',
    maxWidth: '480px',
    padding: '16px',
    boxSizing: 'border-box',
    flex: 1,
  },

  // Swap layout
  swapLayout: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    alignItems: 'center',
  },
  widgetWrap: {
    width: '100%',
  },

  // Chart
  chartCard: {
    width: '100%',
    background: 'linear-gradient(160deg, #0d0015 0%, #100020 100%)',
    border: '1px solid #3b0764',
    borderRadius: '12px',
    overflow: 'hidden',
    boxSizing: 'border-box',
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px 8px',
  },
  chartTitle: {
    color: '#7c3aed',
    fontSize: '9px',
    letterSpacing: '2px',
  },
  chartBadge: {
    background: 'rgba(88, 28, 135, 0.3)',
    border: '1px solid #4c1d95',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '7px',
    color: '#6d28d9',
    letterSpacing: '1px',
  },
  chartBody: {
    position: 'relative',
    height: '100px',
  },
  sparkline: {
    width: '100%',
    height: '100%',
    display: 'block',
    opacity: 0.4,
  },
  chartOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartOverlayText: {
    fontSize: '7px',
    color: '#4c1d95',
    letterSpacing: '1px',
    textAlign: 'center',
  },
  chartFooter: {
    display: 'flex',
    gap: '4px',
    padding: '8px 14px 12px',
    borderTop: '1px solid #1e0035',
  },
  tfBtn: {
    background: 'rgba(88, 28, 135, 0.15)',
    border: '1px solid #3b0764',
    borderRadius: '4px',
    color: '#4c1d95',
    fontFamily: font,
    fontSize: '7px',
    padding: '3px 8px',
    cursor: 'default',
    letterSpacing: '1px',
  },

  // Last TX banner
  txBanner: {
    width: '100%',
    background: 'rgba(88, 28, 135, 0.15)',
    border: '1px solid #3b0764',
    borderRadius: '8px',
    padding: '10px 14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxSizing: 'border-box',
  },
  txBannerLabel: {
    color: '#6d28d9',
    fontSize: '8px',
    letterSpacing: '1px',
  },
  txBannerLink: {
    color: '#a855f7',
    fontSize: '8px',
    letterSpacing: '1px',
    textDecoration: 'none',
    borderBottom: '1px solid #7c3aed',
  },

  // Info tab
  infoCard: {
    background: 'linear-gradient(160deg, #0d0015 0%, #100020 100%)',
    border: '1px solid #3b0764',
    borderRadius: '12px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  infoTitle: {
    color: '#e879f9',
    fontSize: '11px',
    letterSpacing: '3px',
    paddingBottom: '8px',
    borderBottom: '1px solid #3b0764',
    textShadow: '0 0 10px rgba(232, 121, 249, 0.4)',
  },
  infoRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingBottom: '12px',
    borderBottom: '1px solid #1e0035',
  },
  infoKey: {
    color: '#4c1d95',
    fontSize: '8px',
    letterSpacing: '2px',
  },
  infoVal: {
    color: '#a855f7',
    fontSize: '9px',
    letterSpacing: '1px',
    wordBreak: 'break-all',
    lineHeight: '1.6',
  },
  infoLinks: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    paddingTop: '4px',
  },
  infoLink: {
    color: '#7c3aed',
    fontSize: '9px',
    letterSpacing: '1px',
    textDecoration: 'none',
    borderBottom: '1px solid #3b0764',
    paddingBottom: '2px',
    width: 'fit-content',
    transition: 'color 0.15s ease',
  },

  // Footer
  footer: {
    color: '#2d0052',
    fontSize: '7px',
    letterSpacing: '1px',
    textAlign: 'center',
    padding: '20px 16px',
  },
};
