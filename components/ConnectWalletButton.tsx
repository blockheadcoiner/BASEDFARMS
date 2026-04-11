'use client';

import { useState, useRef, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from './WalletProvider';

const font = '"Press Start 2P", "Courier New", monospace';

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
          (e.currentTarget as HTMLButtonElement).style.boxShadow =
            '0 0 20px rgba(168, 85, 247, 0.5)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow =
            '0 0 14px rgba(168, 85, 247, 0.25)';
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
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#a855f7';
          (e.currentTarget as HTMLButtonElement).style.color = '#e879f9';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = '#7c3aed';
          (e.currentTarget as HTMLButtonElement).style.color = '#c084fc';
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
              (e.currentTarget as HTMLButtonElement).style.background =
                'rgba(219, 39, 119, 0.15)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#db2777';
              (e.currentTarget as HTMLButtonElement).style.color = '#f472b6';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'rgba(190, 18, 60, 0.08)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#9f1239';
              (e.currentTarget as HTMLButtonElement).style.color = '#fb7185';
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
    fontSize: '8px',
    letterSpacing: '1px',
    padding: '10px 14px',
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    boxShadow: '0 0 14px rgba(168, 85, 247, 0.25)',
    whiteSpace: 'nowrap',
    transition: 'box-shadow 0.15s',
  },
  connectedBtn: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    padding: '9px 12px',
    background: 'rgba(88, 28, 135, 0.2)',
    border: '1px solid #7c3aed',
    borderRadius: '6px',
    color: '#c084fc',
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
    background: '#a855f7',
    boxShadow: '0 0 6px rgba(168, 85, 247, 0.8)',
    flexShrink: 0,
    display: 'inline-block',
  },
  chevron: {
    fontSize: '6px',
    color: '#6d28d9',
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    background: '#0d0020',
    border: '1px solid #7c3aed',
    borderRadius: '10px',
    boxShadow: '0 0 24px rgba(124, 58, 237, 0.3)',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    zIndex: 100,
    minWidth: '180px',
  },
  dropdownAddr: {
    fontFamily: font,
    fontSize: '7px',
    color: '#6d28d9',
    letterSpacing: '1px',
    padding: '4px 6px',
    wordBreak: 'break-all',
    lineHeight: 1.8,
  },
  disconnectBtn: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    padding: '9px 12px',
    background: 'rgba(190, 18, 60, 0.08)',
    border: '1px solid #9f1239',
    borderRadius: '6px',
    color: '#fb7185',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    transition: 'background 0.15s, border-color 0.15s, color 0.15s',
  },
};
