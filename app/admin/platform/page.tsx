'use client';

import { useState, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { useWalletModal } from '@/components/WalletProvider';
import { createPlatform, derivePlatformId } from '@/services/platform';

const font = 'var(--font-press-start), "Courier New", monospace';

const TREASURY = '6MB3syAmv6rmVavKxZveDdPYrmmwGcwoM2BfkDbfkQd8';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={copy} style={s.copyBtn}>
      {copied ? '✓ COPIED' : 'COPY'}
    </button>
  );
}

type Status = 'idle' | 'pending' | 'done' | 'error';

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export default function PlatformSetupPage() {
  const { publicKey, signAllTransactions } = useWallet();
  const { setVisible } = useWalletModal();

  const [status, setStatus]   = useState<Status>('idle');
  const [result, setResult]   = useState<{ txId: string; platformId: string } | null>(null);
  const [error, setError]     = useState('');

  const isTreasuryWallet = publicKey?.toBase58() === TREASURY;
  const predictedId = useMemo(
    () => (publicKey ? derivePlatformId(publicKey) : null),
    [publicKey],
  );
  const platformIdEnv = process.env.NEXT_PUBLIC_PLATFORM_ID || null;

  const handleCreate = useCallback(async () => {
    if (!publicKey || !signAllTransactions || !isTreasuryWallet) return;
    setStatus('pending');
    setError('');
    try {
      const signAll = signAllTransactions as <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
      const res = await createPlatform(publicKey, signAll);
      setResult(res);
      setStatus('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [publicKey, signAllTransactions, isTreasuryWallet]);

  const platformId = result?.platformId ?? platformIdEnv;
  const txId = result?.txId ?? null;

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={s.header}>
          <div style={s.title}>◈ BASEDFARMS PLATFORM SETUP</div>
          <div style={s.subtitle}>ONE-TIME REGISTRATION · RAYDIUM LAUNCHLAB</div>
        </div>

        {/* ── Run-once warning ───────────────────────────────────────────── */}
        <div style={s.onceCard}>
          <div style={s.onceIcon}>⚠</div>
          <div style={s.onceText}>
            Run this ONCE. The platform ID is derived from the connected wallet.
            After creation, store the platformId in NEXT_PUBLIC_PLATFORM_ID and redeploy.
            Every token launched after that earns BASEDFARMS fees forever.
          </div>
        </div>

        {/* ── Wallet section ─────────────────────────────────────────────── */}
        {!publicKey ? (
          <button style={s.connectBtn} onClick={() => setVisible(true)}>
            CONNECT TREASURY WALLET
          </button>
        ) : (
          <div style={{
            ...s.walletCard,
            borderColor: isTreasuryWallet ? '#166534' : '#7f1d1d',
            background: isTreasuryWallet ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.05)',
          }}>
            <div style={s.walletRow}>
              <span style={s.walletLabel}>CONNECTED WALLET</span>
              <span style={{
                ...s.walletStatus,
                color: isTreasuryWallet ? '#22c55e' : '#f87171',
              }}>
                {isTreasuryWallet ? '✓ TREASURY WALLET' : '✗ WRONG WALLET'}
              </span>
            </div>
            <div style={s.walletAddr}>
              {publicKey.toBase58().slice(0, 14)}…{publicKey.toBase58().slice(-10)}
            </div>
            {!isTreasuryWallet && (
              <div style={s.wrongWalletNote}>
                Connect the treasury wallet ({TREASURY.slice(0, 8)}…{TREASURY.slice(-6)}) to create the platform.
                The platform admin is derived from the connected wallet — this cannot be changed later.
              </div>
            )}
          </div>
        )}

        {/* ── What this sets up ──────────────────────────────────────────── */}
        <div style={s.setupCard}>
          <div style={s.setupTitle}>◈ WHAT THIS REGISTERS</div>
          <div style={s.setupGrid}>
            {[
              { icon: '◈', label: 'Platform fee', value: '1%', note: 'on every bonding curve trade → vault' },
              { icon: '◈', label: 'Creator fee cap', value: '0.5%', note: 'max creators can set per token' },
              { icon: '◈', label: 'LP to BASEDFARMS', value: '10%', note: 'Fee Key NFT at graduation → forever' },
              { icon: '◈', label: 'LP to creator', value: '10%', note: 'Fee Key NFT at graduation → forever' },
              { icon: '◈', label: 'LP burned', value: '80%', note: 'permanently locked · price floor' },
              { icon: '◈', label: 'CPMM fee tier', value: '0.25%', note: 'lowest available pool trading fee' },
            ].map(({ icon, label, value, note }) => (
              <div key={label} style={s.setupRow}>
                <span style={s.setupIcon}>{icon}</span>
                <span style={s.setupLabel}>{label}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={s.setupValue}>{value}</div>
                  <div style={s.setupNote}>{note}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={s.setupMeta}>
            <div style={s.metaRow}>
              <span style={s.metaKey}>name</span>
              <span style={s.metaVal}>BASEDFARMS</span>
            </div>
            <div style={s.metaRow}>
              <span style={s.metaKey}>web</span>
              <span style={s.metaVal}>basedfarms.fun</span>
            </div>
            <div style={s.metaRow}>
              <span style={s.metaKey}>claim/nft wallet</span>
              <span style={s.metaVal}>treasury</span>
            </div>
          </div>
        </div>

        {/* ── Predicted platform ID ──────────────────────────────────────── */}
        {publicKey && !platformId && (
          <div style={s.previewCard}>
            <div style={s.previewLabel}>PREDICTED PLATFORM ID</div>
            <div style={s.addrRow}>
              <code style={s.addr}>{predictedId}</code>
              {predictedId && <CopyBtn text={predictedId} />}
            </div>
            <div style={s.previewNote}>
              Derived from connected wallet · deterministic · no network call
            </div>
          </div>
        )}

        {/* ── Already created ────────────────────────────────────────────── */}
        {platformId && (
          <div style={s.successCard}>
            <div style={s.successTitle}>✓ PLATFORM REGISTERED</div>
            <div style={s.addrLabel}>PLATFORM ID</div>
            <div style={s.addrRow}>
              <code style={s.addrGreen}>{platformId}</code>
              <CopyBtn text={platformId} />
            </div>
            {txId && (
              <>
                <div style={s.addrLabel}>TRANSACTION</div>
                <div style={s.addrRow}>
                  <a
                    href={`https://solscan.io/tx/${txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={s.txLink}
                  >
                    {txId.slice(0, 24)}… ↗ SOLSCAN
                  </a>
                  <CopyBtn text={txId} />
                </div>
              </>
            )}
            {!platformIdEnv && (
              <div style={s.envCard}>
                <div style={s.envTitle}>⚠ SAVE TO ENV — REQUIRED BEFORE REDEPLOYING</div>
                <div style={s.envStep}>
                  <span style={s.envStepNum}>1</span>
                  <div style={s.envStepBody}>
                    <div style={s.envInstruction}>Add to .env.local:</div>
                    <div style={s.envLineRow}>
                      <code style={s.envCode}>NEXT_PUBLIC_PLATFORM_ID={platformId}</code>
                      <CopyBtn text={`NEXT_PUBLIC_PLATFORM_ID=${platformId}`} />
                    </div>
                  </div>
                </div>
                <div style={s.envStep}>
                  <span style={s.envStepNum}>2</span>
                  <div style={s.envStepBody}>
                    <div style={s.envInstruction}>Add to Vercel:</div>
                    <div style={s.envLineRow}>
                      <code style={s.envCode}>vercel env add NEXT_PUBLIC_PLATFORM_ID</code>
                      <CopyBtn text="vercel env add NEXT_PUBLIC_PLATFORM_ID" />
                    </div>
                  </div>
                </div>
                <div style={s.envStep}>
                  <span style={s.envStepNum}>3</span>
                  <div style={s.envStepBody}>
                    <div style={s.envInstruction}>Redeploy. Every token launched after that routes fees here.</div>
                  </div>
                </div>
              </div>
            )}
            {platformIdEnv && (
              <div style={s.envDone}>
                ✓ NEXT_PUBLIC_PLATFORM_ID is set in env — all new launches will earn platform fees.
              </div>
            )}
          </div>
        )}

        {/* ── Create button ──────────────────────────────────────────────── */}
        {publicKey && isTreasuryWallet && (
          <div style={s.createSection}>
            {platformId && (
              <div style={s.alreadyNote}>
                Platform is already registered. Clicking below will attempt to create a new one
                (will fail — only one platform per wallet is allowed by the protocol).
              </div>
            )}
            <button
              style={{
                ...s.createBtn,
                ...(status === 'pending' ? s.createBtnBusy : {}),
                ...(platformId ? s.createBtnWarn : {}),
              }}
              onClick={handleCreate}
              disabled={status === 'pending'}
            >
              {status === 'pending'
                ? 'CREATING… APPROVE IN WALLET'
                : platformId
                ? '⚠ RECREATE PLATFORM'
                : '◈ CREATE BASEDFARMS PLATFORM'}
            </button>
            <div style={s.createNote}>
              ~0.01 SOL · Admin wallet = connected wallet · Run ONCE · Cannot be undone
            </div>
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {status === 'error' && error && (
          <div style={s.errorBox}>
            <div style={s.errorLabel}>ERROR</div>
            <div style={s.errorText}>{error}</div>
            <button style={s.retryBtn} onClick={() => setStatus('idle')}>RETRY</button>
          </div>
        )}

        {/* ── NFT warning ────────────────────────────────────────────────── */}
        <div style={s.nftWarning}>
          <span style={s.nftWarningIcon}>⚠</span>
          <span style={s.nftWarningText}>
            Fee Key NFTs will be sent to the treasury wallet at token graduation.
            Do not burn or transfer them — they represent BASEDFARMS&apos; 10% LP position
            in each CPMM pool. If burned, fee rights are permanently and irreversibly lost.
          </span>
        </div>

      </div>
    </div>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0d0015', padding: '40px 16px 80px', display: 'flex', justifyContent: 'center' },
  container: { width: '100%', maxWidth: '660px', display: 'flex', flexDirection: 'column', gap: '16px' },

  header: { textAlign: 'center', padding: '16px 0 8px' },
  title: { fontFamily: font, fontSize: '12px', letterSpacing: '2px', color: '#e879f9', textShadow: '0 0 20px rgba(232,121,249,0.5)', marginBottom: '8px' },
  subtitle: { fontFamily: font, fontSize: '6px', letterSpacing: '2.5px', color: 'rgba(255,255,255,0.6)' },

  onceCard: { display: 'flex', gap: '12px', padding: '14px', background: 'rgba(245,158,11,0.06)', border: '1px solid #78350f', borderRadius: '10px', alignItems: 'flex-start' },
  onceIcon: { fontFamily: font, fontSize: '10px', color: '#f59e0b', flexShrink: 0 },
  onceText: { fontFamily: font, fontSize: '5.5px', color: '#d97706', letterSpacing: '0.3px', lineHeight: 1.9 },

  connectBtn: { width: '100%', padding: '14px', background: 'rgba(88,28,135,0.2)', border: '1px solid #7c3aed', borderRadius: '10px', color: '#c084fc', fontFamily: font, fontSize: '8px', letterSpacing: '2px', cursor: 'pointer' },

  walletCard: { border: '1px solid', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' },
  walletRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const },
  walletLabel: { fontFamily: font, fontSize: '5px', letterSpacing: '2px', color: '#e2b4ff' },
  walletStatus: { fontFamily: font, fontSize: '6px', letterSpacing: '1px' },
  walletAddr: { fontFamily: font, fontSize: '6px', color: '#ffffff', letterSpacing: '0.3px', wordBreak: 'break-all' as const },
  wrongWalletNote: { fontFamily: font, fontSize: '5px', color: '#fca5a5', letterSpacing: '0.3px', lineHeight: 1.8, marginTop: '4px' },

  setupCard: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(219,39,119,0.2)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
  setupTitle: { fontFamily: font, fontSize: '6px', letterSpacing: '2px', color: '#e2b4ff' },
  setupGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },
  setupRow: { display: 'flex', alignItems: 'flex-start', gap: '10px' },
  setupIcon: { fontFamily: font, fontSize: '7px', color: 'rgba(255,255,255,0.4)', flexShrink: 0, marginTop: '1px' },
  setupLabel: { fontFamily: font, fontSize: '5.5px', color: '#e2b4ff', letterSpacing: '0.5px', flex: 1 },
  setupValue: { fontFamily: font, fontSize: '7px', color: '#ffffff', textAlign: 'right' as const },
  setupNote: { fontFamily: font, fontSize: '4.5px', color: 'rgba(255,255,255,0.6)', textAlign: 'right' as const, letterSpacing: '0.3px', marginTop: '2px' },
  setupMeta: { borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' },
  metaRow: { display: 'flex', justifyContent: 'space-between', gap: '8px' },
  metaKey: { fontFamily: font, fontSize: '5px', color: '#e2b4ff', letterSpacing: '0.5px' },
  metaVal: { fontFamily: font, fontSize: '5px', color: '#ffffff', letterSpacing: '0.5px' },

  previewCard: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(219,39,119,0.2)', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' },
  previewLabel: { fontFamily: font, fontSize: '5px', letterSpacing: '1.5px', color: '#e2b4ff' },
  previewNote: { fontFamily: font, fontSize: '4.5px', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.3px' },

  successCard: { background: 'rgba(34,197,94,0.05)', border: '1px solid #166534', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
  successTitle: { fontFamily: font, fontSize: '8px', letterSpacing: '2px', color: '#22c55e' },
  addrLabel: { fontFamily: font, fontSize: '5px', letterSpacing: '2px', color: '#e2b4ff' },
  addrRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' as const },
  addr: { fontFamily: font, fontSize: '5.5px', color: '#ffffff', letterSpacing: '0.3px', wordBreak: 'break-all' as const, flex: 1 },
  addrGreen: { fontFamily: font, fontSize: '5.5px', color: '#22c55e', letterSpacing: '0.3px', wordBreak: 'break-all' as const, flex: 1 },
  txLink: { fontFamily: font, fontSize: '6px', color: '#22c55e', textDecoration: 'none', flex: 1, letterSpacing: '0.5px' },

  envCard: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(219,39,119,0.2)', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' },
  envTitle: { fontFamily: font, fontSize: '5.5px', letterSpacing: '1.5px', color: '#f59e0b' },
  envStep: { display: 'flex', gap: '10px', alignItems: 'flex-start' },
  envStepNum: { fontFamily: font, fontSize: '7px', color: '#7c3aed', flexShrink: 0, marginTop: '1px' },
  envStepBody: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 },
  envInstruction: { fontFamily: font, fontSize: '5px', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.5px' },
  envLineRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const },
  envCode: { fontFamily: font, fontSize: '5.5px', color: '#c084fc', background: 'rgba(88,28,135,0.2)', padding: '4px 8px', borderRadius: '4px', flex: 1, wordBreak: 'break-all' as const },
  envDone: { fontFamily: font, fontSize: '5.5px', color: '#22c55e', letterSpacing: '0.5px', lineHeight: 1.8 },

  createSection: { display: 'flex', flexDirection: 'column', gap: '8px' },
  alreadyNote: { fontFamily: font, fontSize: '5px', color: '#ef4444', letterSpacing: '0.3px', lineHeight: 1.8, padding: '8px', background: 'rgba(239,68,68,0.05)', border: '1px solid #7f1d1d', borderRadius: '6px' },
  createBtn: { width: '100%', padding: '16px', background: 'linear-gradient(135deg,#7c3aed 0%,#db2777 100%)', border: 'none', borderRadius: '10px', color: '#fff', fontFamily: font, fontSize: '9px', letterSpacing: '2px', cursor: 'pointer', boxShadow: '0 0 24px rgba(124,58,237,0.5), 0 0 48px rgba(219,39,119,0.2)' },
  createBtnBusy: { opacity: 0.6, cursor: 'not-allowed', boxShadow: 'none' },
  createBtnWarn: { background: 'linear-gradient(135deg,#d97706 0%,#ef4444 100%)', boxShadow: '0 0 16px rgba(239,68,68,0.3)', fontSize: '7px' },
  createNote: { fontFamily: font, fontSize: '5px', color: 'rgba(255,255,255,0.6)', letterSpacing: '0.3px', textAlign: 'center' as const, lineHeight: 1.8 },

  errorBox: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', background: 'rgba(239,68,68,0.06)', border: '1px solid #7f1d1d', borderRadius: '8px' },
  errorLabel: { fontFamily: font, fontSize: '6px', color: '#ef4444', letterSpacing: '2px' },
  errorText: { fontFamily: font, fontSize: '5.5px', color: '#fca5a5', letterSpacing: '0.3px', lineHeight: 1.8, wordBreak: 'break-word' as const },
  retryBtn: { fontFamily: font, fontSize: '6px', color: '#ef4444', background: 'transparent', border: '1px solid #7f1d1d', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', alignSelf: 'flex-start' as const },

  copyBtn: { fontFamily: font, fontSize: '5px', letterSpacing: '1px', color: '#e2b4ff', background: 'transparent', border: '1px solid rgba(219,39,119,0.2)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', flexShrink: 0 },

  nftWarning: { display: 'flex', gap: '10px', padding: '12px', background: 'rgba(245,158,11,0.04)', border: '1px solid #451a03', borderRadius: '8px', alignItems: 'flex-start' },
  nftWarningIcon: { fontFamily: font, fontSize: '9px', color: '#92400e', flexShrink: 0 },
  nftWarningText: { fontFamily: font, fontSize: '5px', color: '#78350f', letterSpacing: '0.3px', lineHeight: 1.9 },
};
