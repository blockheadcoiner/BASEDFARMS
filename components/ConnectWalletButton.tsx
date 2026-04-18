'use client';

import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from './WalletProvider';

const font = "'Geist', -apple-system, BlinkMacSystemFont, sans-serif";

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export default function ConnectWalletButton() {
  const { connected, publicKey, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  // Close dropdown when wallet disconnects
  useEffect(() => {
    if (!connected) setDropdownOpen(false);
  }, [connected]);

  if (!connected || !publicKey) {
    return (
      <button
        style={styles.connectBtn}
        onClick={() => setVisible(true)}
        onMouseEnter={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.borderColor = '#f97316';
          btn.style.color = '#ffffff';
        }}
        onMouseLeave={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.borderColor = '#333333';
          btn.style.color = '#888888';
        }}
      >
        CONNECT WALLET
      </button>
    );
  }

  const address = truncateAddress(publicKey.toBase58());

  return (
    <div ref={dropdownRef} style={styles.wrapper}>
      <button
        style={styles.connectedBtn}
        onClick={() => setDropdownOpen((o) => !o)}
        onMouseEnter={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.borderColor = '#16a34a';
          btn.style.color = '#4ade80';
        }}
        onMouseLeave={(e) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.style.borderColor = '#22c55e';
          btn.style.color = '#22c55e';
        }}
      >
        <span style={styles.connectedDot} />
        {address}
        <span style={styles.chevron}>{dropdownOpen ? '▲' : '▼'}</span>
      </button>

      {dropdownOpen && (
        <div style={styles.dropdown}>
          <div style={styles.dropdownAddr}>
            {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-8)}
          </div>
          <button
            style={styles.disconnectBtn}
            onClick={() => {
              disconnect();
              setDropdownOpen(false);
            }}
            onMouseEnter={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = 'rgba(239, 68, 68, 0.12)';
              btn.style.borderColor = '#ef4444';
              btn.style.color = '#fca5a5';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = 'transparent';
              btn.style.borderColor = '#333333';
              btn.style.color = '#888888';
            }}
          >
            ✕ DISCONNECT
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    flexShrink: 0,
  },
  connectBtn: {
    fontFamily: font,
    fontSize: '13px',
    letterSpacing: '0.5px',
    padding: '8px 14px',
    background: 'transparent',
    border: '1px solid #333333',
    borderRadius: '6px',
    color: '#888888',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'border-color 0.15s, color 0.15s',
  },
  connectedBtn: {
    fontFamily: font,
    fontSize: '13px',
    letterSpacing: '0.5px',
    padding: '8px 12px',
    background: 'transparent',
    border: '1px solid #22c55e',
    borderRadius: '6px',
    color: '#22c55e',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    transition: 'border-color 0.15s, color 0.15s',
  },
  connectedDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#22c55e',
    flexShrink: 0,
    display: 'inline-block',
  },
  chevron: {
    fontSize: '6px',
    color: '#555555',
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    background: '#111111',
    border: '1px solid #222222',
    borderRadius: '10px',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: 100,
    minWidth: '180px',
  },
  dropdownAddr: {
    fontFamily: font,
    fontSize: '11px',
    color: '#555555',
    letterSpacing: '0.5px',
    padding: '4px 6px',
    wordBreak: 'break-all',
    lineHeight: 1.8,
  },
  disconnectBtn: {
    fontFamily: font,
    fontSize: '12px',
    letterSpacing: '0.5px',
    padding: '9px 12px',
    background: 'transparent',
    border: '1px solid #333333',
    borderRadius: '6px',
    color: '#888888',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
  },
};
