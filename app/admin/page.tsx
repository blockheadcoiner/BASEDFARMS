'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { useWalletModal } from '@/components/WalletProvider';
import { createPlatform, derivePlatformId } from '@/services/platform';

const font = 'var(--font-press-start), "Courier New", monospace';

/* ── Copy-to-clipboard button ─────────────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={handleCopy} style={s.copyBtn}>
      {copied ? '✓ COPIED' : 'COPY'}
    </button>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */

export default function AdminPage() {
  const { publicKey, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();

  const [status, setStatus] = useState<'idle' | 'creating' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ txId: string; platformId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existingPlatformId = process.env.NEXT_PUBLIC_PLATFORM_ID;
  const derivedId = publicKey ? derivePlatformId(publicKey) : null;

  const handleCreate = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    setStatus('creating');
    setError(null);
    try {
      const typedSign = signTransaction as (tx: Transaction) => Promise<Transaction>;
      const res = await createPlatform(publicKey, typedSign);
      setResult(res);
      setStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      console.error('[Admin] createPlatform error:', err);
    }
  }, [publicKey, signTransaction]);

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* Header */}
        <div style={s.header}>
          <div style={s.title}>◈ BASEDFARMS ADMIN</div>
          <div style={s.subtitle}>PLATFORM CONFIGURATION</div>
        </div>

        {/* Info card */}
        <div style={s.infoCard}>
          <div style={s.infoTitle}>WHAT THIS DOES</div>
          <div style={s.infoBody}>
            Registers BASEDFARMS as a platform on Raydium LaunchLab.
            Once created, every token launched through BASEDFARMS routes
            fees to the platform wallet and awards LP positions at graduation.
          </div>
          <div style={s.featureGrid}>
            {[
              { label: 'PLATFORM FEE', value: '0%' },
              { label: 'CREATOR FEE MAX', value: '1%' },
              { label: 'LP → PLATFORM', value: '5%' },
              { label: 'LP → CREATOR', value: '10%' },
              { label: 'LP BURNED', value: '85%' },
            ].map(({ label, value }) => (
              <div key={label} style={s.featureRow}>
                <span style={s.featureLabel}>{label}</span>
                <span style={s.featureValue}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Already configured */}
        {existingPlatformId && (
          <div style={s.existingCard}>
            <div style={s.existingTitle}>✓ PLATFORM ALREADY CONFIGURED</div>
            <div style={s.existingLabel}>NEXT_PUBLIC_PLATFORM_ID</div>
            <div style={s.addressRow}>
              <code style={s.address}>{existingPlatformId}</code>
              <CopyButton text={existingPlatformId} />
            </div>
          </div>
        )}

        {/* Derived ID preview */}
        {publicKey && !existingPlatformId && (
          <div style={s.previewCard}>
            <div style={s.previewTitle}>PREDICTED PLATFORM ID</div>
            <div style={s.previewHint}>
              This is the PDA that will be created when you sign.
              Derived from your wallet: {publicKey.toBase58().slice(0, 8)}…
            </div>
            <div style={s.addressRow}>
              <code style={s.address}>{derivedId}</code>
              <CopyButton text={derivedId!} />
            </div>
          </div>
        )}

        {/* Success */}
        {status === 'done' && result && (
          <div style={s.successCard}>
            <div style={s.successTitle}>✓ PLATFORM CREATED</div>

            <div style={s.resultSection}>
              <div style={s.resultLabel}>PLATFORM ID</div>
              <div style={s.addressRow}>
                <code style={s.address}>{result.platformId}</code>
                <CopyButton text={result.platformId} />
              </div>
            </div>

            <div style={s.resultSection}>
              <div style={s.resultLabel}>TRANSACTION</div>
              <div style={s.addressRow}>
                <a
                  href={`https://solscan.io/tx/${result.txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={s.txLink}
                >
                  {result.txId.slice(0, 24)}…
                </a>
                <CopyButton text={result.txId} />
              </div>
            </div>

            <div style={s.nextSteps}>
              <div style={s.nextStepsTitle}>NEXT STEPS</div>
              <ol style={s.nextStepsList}>
                <li style={s.nextStep}>
                  Add to <code style={s.code}>.env.local</code>:
                  <div style={s.envLine}>
                    <code style={s.code}>NEXT_PUBLIC_PLATFORM_ID={result.platformId}</code>
                    <CopyButton text={`NEXT_PUBLIC_PLATFORM_ID=${result.platformId}`} />
                  </div>
                </li>
                <li style={s.nextStep}>
                  Add to Vercel env vars (Production + Preview):
                  <div style={s.envLine}>
                    <code style={s.code}>vercel env add NEXT_PUBLIC_PLATFORM_ID</code>
                    <CopyButton text={`vercel env add NEXT_PUBLIC_PLATFORM_ID`} />
                  </div>
                </li>
                <li style={s.nextStep}>
                  Redeploy — every new token launch will now route fees to your platform.
                </li>
              </ol>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && error && (
          <div style={s.errorCard}>
            <div style={s.errorTitle}>✗ ERROR</div>
            <div style={s.errorMsg}>{error}</div>
            <button style={s.retryBtn} onClick={() => { setStatus('idle'); setError(null); }}>
              RETRY
            </button>
          </div>
        )}

        {/* Action */}
        <div style={s.actionSection}>
          {!publicKey ? (
            <button style={s.connectBtn} onClick={() => setVisible(true)}>
              CONNECT WALLET TO BEGIN
            </button>
          ) : status === 'idle' || status === 'error' ? (
            <button
              style={existingPlatformId ? { ...s.createBtn, ...s.createBtnWarn } : s.createBtn}
              onClick={handleCreate}
            >
              {existingPlatformId ? '⚠ CREATE AGAIN (OVERRIDES EXISTING)' : '◈ CREATE PLATFORM'}
            </button>
          ) : status === 'creating' ? (
            <button style={{ ...s.createBtn, opacity: 0.6, cursor: 'not-allowed' }} disabled>
              CREATING… APPROVE IN WALLET
            </button>
          ) : null}

          {publicKey && (
            <div style={s.walletNote}>
              Connected: {publicKey.toBase58().slice(0, 8)}…{publicKey.toBase58().slice(-6)}
              <br />
              This wallet becomes the platform admin.
            </div>
          )}
        </div>

        {/* Warning */}
        <div style={s.warningCard}>
          <div style={s.warningTitle}>⚠ IMPORTANT</div>
          <div style={s.warningBody}>
            The connected wallet becomes the permanent{' '}
            <strong style={{ color: '#fbbf24' }}>platformAdmin</strong>. Platform settings
            can only be updated by this wallet. Keep access to it. This action costs ~0.01 SOL.
          </div>
        </div>

      </div>
    </div>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0d0015',
    padding: '40px 16px 80px',
    display: 'flex',
    justifyContent: 'center',
  },
  container: {
    width: '100%',
    maxWidth: '640px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  header: {
    textAlign: 'center',
    padding: '20px 0 10px',
  },
  title: {
    fontFamily: font,
    fontSize: '14px',
    letterSpacing: '3px',
    color: '#e879f9',
    textShadow: '0 0 20px rgba(232, 121, 249, 0.5)',
    marginBottom: '8px',
  },
  subtitle: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '3px',
    color: '#4c1d95',
  },
  infoCard: {
    background: 'rgba(13, 0, 32, 0.95)',
    border: '1px solid #3b0764',
    borderRadius: '12px',
    padding: '20px',
  },
  infoTitle: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    color: '#7c3aed',
    marginBottom: '10px',
  },
  infoBody: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '0.5px',
    color: '#6d28d9',
    lineHeight: 1.8,
    marginBottom: '14px',
  },
  featureGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    borderTop: '1px solid #1e0035',
    paddingTop: '12px',
  },
  featureRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  featureLabel: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '1px',
    color: '#4c1d95',
  },
  featureValue: {
    fontFamily: font,
    fontSize: '7px',
    color: '#c084fc',
    letterSpacing: '1px',
  },
  existingCard: {
    background: 'rgba(34, 197, 94, 0.06)',
    border: '1px solid #166534',
    borderRadius: '12px',
    padding: '16px',
  },
  existingTitle: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    color: '#22c55e',
    marginBottom: '10px',
  },
  existingLabel: {
    fontFamily: font,
    fontSize: '5px',
    letterSpacing: '1px',
    color: '#166534',
    marginBottom: '6px',
  },
  previewCard: {
    background: 'rgba(88, 28, 135, 0.08)',
    border: '1px solid #3b0764',
    borderRadius: '12px',
    padding: '16px',
  },
  previewTitle: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    color: '#7c3aed',
    marginBottom: '6px',
  },
  previewHint: {
    fontFamily: font,
    fontSize: '5px',
    letterSpacing: '0.3px',
    color: '#4c1d95',
    lineHeight: 1.8,
    marginBottom: '10px',
  },
  successCard: {
    background: 'rgba(34, 197, 94, 0.06)',
    border: '1px solid #22c55e',
    borderRadius: '12px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  successTitle: {
    fontFamily: font,
    fontSize: '10px',
    letterSpacing: '2px',
    color: '#22c55e',
    textShadow: '0 0 12px rgba(34, 197, 94, 0.5)',
  },
  resultSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  resultLabel: {
    fontFamily: font,
    fontSize: '5px',
    letterSpacing: '2px',
    color: '#166534',
  },
  addressRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  address: {
    fontFamily: font,
    fontSize: '6px',
    color: '#22c55e',
    letterSpacing: '0.5px',
    wordBreak: 'break-all',
    flex: 1,
  },
  txLink: {
    fontFamily: font,
    fontSize: '6px',
    color: '#22c55e',
    textDecoration: 'none',
    letterSpacing: '0.5px',
    flex: 1,
  },
  copyBtn: {
    fontFamily: font,
    fontSize: '5px',
    letterSpacing: '1px',
    color: '#c084fc',
    background: 'transparent',
    border: '1px solid #3b0764',
    borderRadius: '4px',
    padding: '4px 8px',
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  nextSteps: {
    background: 'rgba(13, 0, 32, 0.6)',
    border: '1px solid #1e0035',
    borderRadius: '8px',
    padding: '14px',
  },
  nextStepsTitle: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '2px',
    color: '#7c3aed',
    marginBottom: '12px',
  },
  nextStepsList: {
    margin: 0,
    padding: '0 0 0 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  nextStep: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '0.3px',
    color: '#6d28d9',
    lineHeight: 2,
  },
  envLine: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '6px',
    flexWrap: 'wrap',
  },
  code: {
    fontFamily: font,
    fontSize: '6px',
    color: '#c084fc',
    background: 'rgba(88, 28, 135, 0.2)',
    padding: '3px 6px',
    borderRadius: '3px',
  },
  errorCard: {
    background: 'rgba(239, 68, 68, 0.06)',
    border: '1px solid #ef4444',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  errorTitle: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '2px',
    color: '#ef4444',
  },
  errorMsg: {
    fontFamily: font,
    fontSize: '6px',
    color: '#fca5a5',
    letterSpacing: '0.3px',
    lineHeight: 1.8,
    wordBreak: 'break-word',
  },
  retryBtn: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    color: '#ef4444',
    background: 'transparent',
    border: '1px solid #ef4444',
    borderRadius: '6px',
    padding: '8px 16px',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  actionSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  connectBtn: {
    width: '100%',
    padding: '16px',
    background: 'rgba(88, 28, 135, 0.2)',
    border: '1px solid #7c3aed',
    borderRadius: '10px',
    color: '#c084fc',
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '2px',
    cursor: 'pointer',
  },
  createBtn: {
    width: '100%',
    padding: '16px',
    background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
    fontFamily: font,
    fontSize: '9px',
    letterSpacing: '2px',
    cursor: 'pointer',
    boxShadow: '0 0 20px rgba(124, 58, 237, 0.4)',
  },
  createBtnWarn: {
    background: 'linear-gradient(135deg, #d97706 0%, #ef4444 100%)',
    boxShadow: '0 0 20px rgba(239, 68, 68, 0.3)',
    fontSize: '7px',
  },
  walletNote: {
    fontFamily: font,
    fontSize: '5px',
    letterSpacing: '0.5px',
    color: '#3b0764',
    lineHeight: 2,
    textAlign: 'center',
  },
  warningCard: {
    background: 'rgba(245, 158, 11, 0.05)',
    border: '1px solid #78350f',
    borderRadius: '10px',
    padding: '14px',
  },
  warningTitle: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    color: '#f59e0b',
    marginBottom: '8px',
  },
  warningBody: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '0.3px',
    color: '#92400e',
    lineHeight: 1.8,
  },
};
