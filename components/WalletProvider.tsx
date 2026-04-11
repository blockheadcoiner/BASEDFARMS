'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
  useWallet,
} from '@solana/wallet-adapter-react';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';

/* ── Modal context ── */
interface WalletModalCtx {
  visible: boolean;
  setVisible: (v: boolean) => void;
}

const WalletModalContext = createContext<WalletModalCtx>({
  visible: false,
  setVisible: () => {},
});

export function useWalletModal() {
  return useContext(WalletModalContext);
}

/* ── Custom wallet selection modal ── */
const font = '"Press Start 2P", "Courier New", monospace';

function WalletModal({ onClose }: { onClose: () => void }) {
  const { wallets, select } = useWallet();

  // Installed wallets first, then others
  const sorted = useMemo(() => {
    const installed = wallets.filter((w) => w.readyState === 'Installed');
    const rest = wallets.filter(
      (w) => w.readyState !== 'Installed' && w.readyState !== 'Unsupported',
    );
    return [...installed, ...rest];
  }, [wallets]);

  const handleSelect = (name: string) => {
    // WalletName is a branded string — adapter.name satisfies the type
    select(name as Parameters<ReturnType<typeof useWallet>['select']>[0]);
    onClose();
  };

  return (
    /* Overlay */
    <div
      style={modal.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Select wallet"
    >
      {/* Panel */}
      <div style={modal.panel}>
        {/* Header */}
        <div style={modal.header}>
          <span style={modal.title}>SELECT WALLET</span>
          <button style={modal.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* Wallet list */}
        <div style={modal.list}>
          {sorted.length === 0 && (
            <p style={modal.empty}>NO WALLETS DETECTED</p>
          )}
          {sorted.map((w) => {
            const installed = w.readyState === 'Installed';
            return (
              <button
                key={w.adapter.name}
                style={modal.walletRow}
                onClick={() => handleSelect(w.adapter.name)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'rgba(124, 58, 237, 0.18)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    '#7c3aed';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'rgba(88, 28, 135, 0.08)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor =
                    '#3b0764';
                }}
              >
                {w.adapter.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={w.adapter.icon}
                    alt={w.adapter.name}
                    style={modal.walletIcon}
                  />
                ) : (
                  <span style={modal.walletIconFallback}>◈</span>
                )}
                <span style={modal.walletName}>{w.adapter.name}</span>
                {installed && (
                  <span style={modal.detectedBadge}>DETECTED</span>
                )}
              </button>
            );
          })}
        </div>

        <p style={modal.footer}>
          NEW TO SOLANA?&nbsp;
          <a
            href="https://phantom.app"
            target="_blank"
            rel="noopener noreferrer"
            style={modal.footerLink}
          >
            GET PHANTOM ↗
          </a>
        </p>
      </div>
    </div>
  );
}

function WalletModalWrapper() {
  const { visible, setVisible } = useWalletModal();
  if (!visible) return null;
  return <WalletModal onClose={() => setVisible(false)} />;
}

/* ── Inner provider (lives inside SolanaWalletProvider so hooks work) ── */
function InnerProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <WalletModalContext.Provider value={{ visible, setVisible }}>
      {children}
      <WalletModalWrapper />
    </WalletModalContext.Provider>
  );
}

/* ── Public provider ── */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Use || (not ??) so an empty-string env var also triggers the fallback.
  // Validate it starts with https:// so a misconfigured var never breaks SSR.
  const raw = process.env.NEXT_PUBLIC_RPC_URL || '';
  const endpoint = raw.startsWith('https://')
    ? raw
    : 'https://mainnet.helius-rpc.com/?api-key=229cc849-fb9c-4ef0-968a-a0402480d121';

  // Only instantiate wallet adapters in the browser — they access window.
  // Phantom / Backpack auto-register via Wallet Standard without explicit adapters.
  const wallets = useMemo(
    () => (typeof window !== 'undefined' ? [new SolflareWalletAdapter()] : []),
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <InnerProvider>{children}</InnerProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}

/* ── Styles ── */
const modal: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '16px',
    boxSizing: 'border-box',
  },
  panel: {
    background: '#0d0020',
    border: '1px solid #7c3aed',
    borderRadius: '14px',
    boxShadow:
      '0 0 40px rgba(124, 58, 237, 0.35), 0 0 80px rgba(124, 58, 237, 0.12), inset 0 0 40px rgba(88, 28, 135, 0.08)',
    width: '100%',
    maxWidth: '380px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
    overflow: 'hidden',
    fontFamily: font,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 20px 16px',
    borderBottom: '1px solid #3b0764',
  },
  title: {
    color: '#e879f9',
    fontSize: '11px',
    letterSpacing: '2px',
    textShadow: '0 0 10px rgba(232, 121, 249, 0.5)',
  },
  closeBtn: {
    background: 'transparent',
    border: '1px solid #3b0764',
    borderRadius: '6px',
    color: '#6d28d9',
    fontFamily: font,
    fontSize: '10px',
    padding: '4px 8px',
    cursor: 'pointer',
    lineHeight: 1,
    transition: 'color 0.15s, border-color 0.15s',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '16px',
    maxHeight: '360px',
    overflowY: 'auto',
  },
  empty: {
    color: '#4c1d95',
    fontSize: '8px',
    letterSpacing: '2px',
    textAlign: 'center',
    padding: '20px 0',
    margin: 0,
  },
  walletRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: 'rgba(88, 28, 135, 0.08)',
    border: '1px solid #3b0764',
    borderRadius: '10px',
    padding: '12px 14px',
    cursor: 'pointer',
    fontFamily: font,
    transition: 'background 0.15s, border-color 0.15s',
    width: '100%',
    textAlign: 'left',
  },
  walletIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    flexShrink: 0,
    objectFit: 'contain',
  },
  walletIconFallback: {
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#7c3aed',
    fontSize: '20px',
    flexShrink: 0,
  },
  walletName: {
    flex: 1,
    color: '#c084fc',
    fontSize: '9px',
    letterSpacing: '1.5px',
  },
  detectedBadge: {
    background: 'rgba(124, 58, 237, 0.2)',
    border: '1px solid #7c3aed',
    borderRadius: '4px',
    color: '#a855f7',
    fontSize: '6px',
    letterSpacing: '1px',
    padding: '3px 6px',
    flexShrink: 0,
  },
  footer: {
    margin: 0,
    color: '#3b0764',
    fontSize: '7px',
    letterSpacing: '1px',
    textAlign: 'center',
    padding: '14px 20px 18px',
    borderTop: '1px solid #1e0035',
  },
  footerLink: {
    color: '#6d28d9',
    textDecoration: 'none',
  },
};
