'use client';

import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { useWalletModal } from '@/components/WalletProvider';
import {
  createPlatform,
  claimBondingCurveFees,
  harvestCpmmLpFees,
  derivePlatformId,
} from '@/services/platform';

const font = 'var(--font-press-start), "Courier New", monospace';

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
      {copied ? '✓' : 'COPY'}
    </button>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span style={{ ...s.dot, background: active ? '#22c55e' : '#3b0764',
      boxShadow: active ? '0 0 6px #22c55e' : 'none' }} />
  );
}

type OpStatus = 'idle' | 'pending' | 'done' | 'error';

/* ═══════════════════════════════════════════════════════════════════════════
   INCOME STREAM CARDS
   ═══════════════════════════════════════════════════════════════════════════ */

function StreamCard({
  number,
  title,
  subtitle,
  detail,
  active,
  children,
}: {
  number: string;
  title: string;
  subtitle: string;
  detail: string;
  active: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ ...s.streamCard, borderColor: active ? '#3b0764' : '#1e0035' }}>
      <div style={s.streamHeader}>
        <div style={s.streamNum}>{number}</div>
        <div style={{ flex: 1 }}>
          <div style={s.streamTitle}>{title}</div>
          <div style={s.streamSub}>{subtitle}</div>
        </div>
        <StatusDot active={active} />
      </div>
      <div style={s.streamDetail}>{detail}</div>
      {children && <div style={s.streamAction}>{children}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export default function AdminPage() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { setVisible } = useWalletModal();

  const [createStatus, setCreateStatus]   = useState<OpStatus>('idle');
  const [claimStatus, setClaimStatus]     = useState<OpStatus>('idle');
  const [harvestStatus, setHarvestStatus] = useState<OpStatus>('idle');

  const [createResult, setCreateResult] = useState<{ txId: string; platformId: string } | null>(null);
  const [claimTxId, setClaimTxId]       = useState<string | null>(null);
  const [harvestResult, setHarvestResult] = useState<{ txIds: string[]; positionsHarvested: number } | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const platformIdEnv = process.env.NEXT_PUBLIC_PLATFORM_ID || null;
  const activePlatformId = createResult?.platformId ?? platformIdEnv;
  const derivedId = publicKey ? derivePlatformId(publicKey) : null;

  /* ── Create platform ──────────────────────────────────────────────────── */
  const handleCreate = useCallback(async () => {
    if (!publicKey || !signAllTransactions) return;
    setCreateStatus('pending');
    setErrors((e) => ({ ...e, create: '' }));
    try {
      const signAll = signAllTransactions as <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
      const res = await createPlatform(publicKey, signAll);
      setCreateResult(res);
      setCreateStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors((e) => ({ ...e, create: msg }));
      setCreateStatus('error');
    }
  }, [publicKey, signAllTransactions]);

  /* ── Claim bonding curve fees ─────────────────────────────────────────── */
  const handleClaim = useCallback(async () => {
    if (!publicKey || !signTransaction || !activePlatformId) return;
    setClaimStatus('pending');
    setErrors((e) => ({ ...e, claim: '' }));
    try {
      const sign = signTransaction as (tx: Transaction) => Promise<Transaction>;
      const res = await claimBondingCurveFees(publicKey, sign, new PublicKey(activePlatformId));
      setClaimTxId(res.txId);
      setClaimStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors((e) => ({ ...e, claim: msg }));
      setClaimStatus('error');
    }
  }, [publicKey, signTransaction, activePlatformId]);

  /* ── Harvest CPMM LP fees ─────────────────────────────────────────────── */
  const handleHarvest = useCallback(async () => {
    if (!publicKey || !signAllTransactions) return;
    setHarvestStatus('pending');
    setErrors((e) => ({ ...e, harvest: '' }));
    try {
      const signAll = signAllTransactions as <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
      const res = await harvestCpmmLpFees(publicKey, signAll);
      setHarvestResult(res);
      setHarvestStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrors((e) => ({ ...e, harvest: msg }));
      setHarvestStatus('error');
    }
  }, [publicKey, signAllTransactions]);

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* Header */}
        <div style={s.header}>
          <div style={s.title}>◈ BASEDFARMS ADMIN</div>
          <div style={s.subtitle}>PLATFORM INCOME DASHBOARD</div>
        </div>

        {/* Wallet */}
        {!publicKey ? (
          <button style={s.connectBtn} onClick={() => setVisible(true)}>
            CONNECT ADMIN WALLET
          </button>
        ) : (
          <div style={s.walletBar}>
            <span style={s.walletLabel}>ADMIN WALLET</span>
            <span style={s.walletAddr}>
              {publicKey.toBase58().slice(0, 10)}…{publicKey.toBase58().slice(-8)}
            </span>
          </div>
        )}

        {/* ── INCOME STREAMS ── */}
        <div style={s.sectionTitle}>◈ INCOME STREAMS</div>

        {/* Stream 1 — Share fee (always active) */}
        <StreamCard
          number="01"
          title="BONDING CURVE · SHARE FEE"
          subtitle="0.3% of every buy & sell → treasury"
          detail="Direct transfer to treasury wallet on each trade. No claiming needed — funds land instantly. Active for every token ever launched on BASEDFARMS regardless of platform registration."
          active={true}
        />

        {/* Stream 2 — Platform vault fee */}
        <StreamCard
          number="02"
          title="BONDING CURVE · PLATFORM FEE"
          subtitle="1% of every buy & sell → vault → claim"
          detail={activePlatformId
            ? 'Platform registered. 1% of every bonding curve trade accumulates in your vault. Claim anytime — no minimum, no expiry.'
            : 'Requires platform registration (step below). Once set, 1% of every bonding curve trade on BASEDFARMS accumulates here.'}
          active={!!activePlatformId}
        >
          {activePlatformId && publicKey && (
            <>
              <ActionBtn
                label="CLAIM PLATFORM VAULT FEES"
                status={claimStatus}
                pendingLabel="CLAIMING…"
                onClick={handleClaim}
              />
              {claimStatus === 'done' && claimTxId && (
                <TxResult label="CLAIMED" txId={claimTxId} />
              )}
              {claimStatus === 'error' && errors.claim && (
                <ErrorMsg msg={errors.claim} onRetry={() => setClaimStatus('idle')} />
              )}
            </>
          )}
        </StreamCard>

        {/* Stream 3 — CPMM LP fees */}
        <StreamCard
          number="03"
          title="CPMM POOL · LP FEES · FOREVER"
          subtitle="5% of all post-graduation LP trading fees"
          detail={activePlatformId
            ? 'Platform registered. When tokens graduate (hit SOL target), BASEDFARMS receives a Fee Key NFT = 5% LP in the CPMM pool. That pool earns fees from every Raydium trade — forever. Harvest accumulates across all graduated tokens.'
            : 'Requires platform registration. At graduation, BASEDFARMS gets a Fee Key NFT (5% LP position). Every trade on Raydium generates fees — harvest them anytime.'}
          active={!!activePlatformId}
        >
          {activePlatformId && publicKey && (
            <>
              <ActionBtn
                label="HARVEST ALL LP FEES"
                status={harvestStatus}
                pendingLabel="HARVESTING… APPROVE IN WALLET"
                onClick={handleHarvest}
              />
              {harvestStatus === 'done' && harvestResult && (
                harvestResult.positionsHarvested === 0
                  ? <div style={s.emptyHarvest}>No graduated tokens with pending LP fees yet.</div>
                  : <HarvestResult result={harvestResult} />
              )}
              {harvestStatus === 'error' && errors.harvest && (
                <ErrorMsg msg={errors.harvest} onRetry={() => setHarvestStatus('idle')} />
              )}
            </>
          )}
        </StreamCard>

        {/* ── PLATFORM SETUP ── */}
        <div style={s.sectionTitle}>◈ PLATFORM SETUP</div>

        {/* Current platform ID */}
        {activePlatformId && (
          <div style={s.platformCard}>
            <div style={s.platformStatus}>✓ PLATFORM REGISTERED</div>
            <div style={s.addrLabel}>PLATFORM ID</div>
            <div style={s.addrRow}>
              <code style={s.addr}>{activePlatformId}</code>
              <CopyBtn text={activePlatformId} />
            </div>
            {!platformIdEnv && (
              <div style={s.envReminder}>
                <div style={s.envReminderTitle}>⚠ SAVE TO ENV VARS</div>
                <div style={s.envLine}>
                  <code style={s.code}>NEXT_PUBLIC_PLATFORM_ID={activePlatformId}</code>
                  <CopyBtn text={`NEXT_PUBLIC_PLATFORM_ID=${activePlatformId}`} />
                </div>
                <div style={s.envLine}>
                  <code style={s.code}>vercel env add NEXT_PUBLIC_PLATFORM_ID</code>
                  <CopyBtn text="vercel env add NEXT_PUBLIC_PLATFORM_ID" />
                </div>
                <div style={s.envNote}>
                  Add to .env.local and Vercel, then redeploy. Every new token launch will route fees here.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Predicted PDA */}
        {publicKey && !activePlatformId && (
          <div style={s.previewCard}>
            <div style={s.previewLabel}>PREDICTED PLATFORM ID (from your wallet)</div>
            <div style={s.addrRow}>
              <code style={s.addr}>{derivedId}</code>
              <CopyBtn text={derivedId!} />
            </div>
          </div>
        )}

        {/* Create button */}
        {publicKey && (
          <div style={s.createSection}>
            <ActionBtn
              label={activePlatformId ? '⚠ RECREATE PLATFORM' : '◈ CREATE PLATFORM'}
              status={createStatus}
              pendingLabel="CREATING… APPROVE IN WALLET"
              onClick={handleCreate}
              warn={!!activePlatformId}
            />
            {createStatus === 'done' && createResult && (
              <TxResult label="CREATED" txId={createResult.txId} />
            )}
            {createStatus === 'error' && errors.create && (
              <ErrorMsg msg={errors.create} onRetry={() => setCreateStatus('idle')} />
            )}
            <div style={s.createNote}>
              This wallet becomes platformAdmin. ~0.01 SOL. Run once.
            </div>
          </div>
        )}

        {/* Fee structure reference */}
        <div style={s.feeCard}>
          <div style={s.feeTitle}>FEE STRUCTURE</div>
          <div style={s.feeGrid}>
            {[
              { label: 'Share fee (direct)', value: '0.3%', note: 'per bonding curve trade → treasury' },
              { label: 'Platform fee (vault)', value: '1%', note: 'per bonding curve trade → claim' },
              { label: 'LP to BASEDFARMS', value: '10%', note: 'of CPMM pool at graduation → harvest' },
              { label: 'LP to creator', value: '10%', note: 'of CPMM pool at graduation' },
              { label: 'LP burned', value: '80%', note: 'permanently locked' },
              { label: 'Creator fee max', value: '0.5%', note: 'creator-set per token' },
            ].map(({ label, value, note }) => (
              <div key={label} style={s.feeRow}>
                <span style={s.feeLabel}>{label}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={s.feeValue}>{value}</div>
                  <div style={s.feeNote}>{note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Warning */}
        <div style={s.warning}>
          <span style={s.warningIcon}>⚠</span>
          <span style={s.warningText}>
            Do not burn or transfer the Fee Key NFTs in this wallet. They represent
            BASEDFARMS&apos; share of CPMM pool LP fees. If burned, fee rights are permanently lost.
          </span>
        </div>

      </div>
    </div>
  );
}

/* ── Shared sub-components ────────────────────────────────────────────────── */

function ActionBtn({
  label, status, pendingLabel, onClick, warn = false,
}: {
  label: string; status: OpStatus; pendingLabel: string;
  onClick: () => void; warn?: boolean;
}) {
  const busy = status === 'pending';
  return (
    <button
      style={{
        ...s.actionBtn,
        ...(warn ? s.actionBtnWarn : {}),
        ...(busy ? s.actionBtnBusy : {}),
      }}
      onClick={onClick}
      disabled={busy}
    >
      {busy ? pendingLabel : label}
    </button>
  );
}

function TxResult({ label, txId }: { label: string; txId: string }) {
  return (
    <div style={s.txResult}>
      <span style={s.txResultLabel}>✓ {label}</span>
      <a
        href={`https://solscan.io/tx/${txId}`}
        target="_blank"
        rel="noopener noreferrer"
        style={s.txLink}
      >
        {txId.slice(0, 20)}…
      </a>
      <CopyBtn text={txId} />
    </div>
  );
}

function HarvestResult({ result }: { result: { txIds: string[]; positionsHarvested: number } }) {
  return (
    <div style={s.harvestResult}>
      <div style={s.harvestTitle}>
        ✓ HARVESTED {result.positionsHarvested} POSITION{result.positionsHarvested !== 1 ? 'S' : ''}
      </div>
      {result.txIds.map((txId, i) => (
        <div key={txId} style={s.txResult}>
          <span style={s.txResultLabel}>TX {i + 1}</span>
          <a href={`https://solscan.io/tx/${txId}`} target="_blank" rel="noopener noreferrer" style={s.txLink}>
            {txId.slice(0, 20)}…
          </a>
          <CopyBtn text={txId} />
        </div>
      ))}
    </div>
  );
}

function ErrorMsg({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div style={s.errorBox}>
      <span style={s.errorText}>{msg}</span>
      <button style={s.retryBtn} onClick={onRetry}>RETRY</button>
    </div>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0d0015', padding: '40px 16px 80px', display: 'flex', justifyContent: 'center' },
  container: { width: '100%', maxWidth: '680px', display: 'flex', flexDirection: 'column', gap: '16px' },
  header: { textAlign: 'center', padding: '16px 0 8px' },
  title: { fontFamily: font, fontSize: '13px', letterSpacing: '3px', color: '#e879f9', textShadow: '0 0 20px rgba(232,121,249,0.5)', marginBottom: '8px' },
  subtitle: { fontFamily: font, fontSize: '6px', letterSpacing: '3px', color: '#4c1d95' },

  connectBtn: { width: '100%', padding: '14px', background: 'rgba(88,28,135,0.2)', border: '1px solid #7c3aed', borderRadius: '10px', color: '#c084fc', fontFamily: font, fontSize: '8px', letterSpacing: '2px', cursor: 'pointer' },
  walletBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(13,0,32,0.8)', border: '1px solid #1e0035', borderRadius: '8px' },
  walletLabel: { fontFamily: font, fontSize: '5px', letterSpacing: '2px', color: '#3b0764' },
  walletAddr: { fontFamily: font, fontSize: '6px', color: '#c084fc', letterSpacing: '0.5px' },

  sectionTitle: { fontFamily: font, fontSize: '7px', letterSpacing: '3px', color: '#7c3aed', marginTop: '8px', paddingBottom: '4px', borderBottom: '1px solid #1e0035' },

  // Stream card
  streamCard: { background: 'rgba(13,0,32,0.9)', border: '1px solid #1e0035', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' },
  streamHeader: { display: 'flex', alignItems: 'flex-start', gap: '12px' },
  streamNum: { fontFamily: font, fontSize: '8px', color: '#3b0764', letterSpacing: '1px', flexShrink: 0, marginTop: '2px' },
  streamTitle: { fontFamily: font, fontSize: '7px', letterSpacing: '1px', color: '#c084fc', marginBottom: '4px' },
  streamSub: { fontFamily: font, fontSize: '6px', color: '#db2777', letterSpacing: '0.5px' },
  streamDetail: { fontFamily: font, fontSize: '5.5px', color: '#4c1d95', letterSpacing: '0.3px', lineHeight: 1.8 },
  streamAction: { borderTop: '1px solid #1e0035', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '4px' },

  // Platform card
  platformCard: { background: 'rgba(34,197,94,0.05)', border: '1px solid #166534', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' },
  platformStatus: { fontFamily: font, fontSize: '7px', letterSpacing: '2px', color: '#22c55e' },
  addrLabel: { fontFamily: font, fontSize: '5px', letterSpacing: '2px', color: '#166534' },
  addrRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' as const },
  addr: { fontFamily: font, fontSize: '6px', color: '#22c55e', letterSpacing: '0.3px', wordBreak: 'break-all' as const, flex: 1 },
  envReminder: { background: 'rgba(13,0,32,0.6)', border: '1px solid #1e0035', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  envReminderTitle: { fontFamily: font, fontSize: '6px', letterSpacing: '2px', color: '#f59e0b' },
  envLine: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const },
  code: { fontFamily: font, fontSize: '6px', color: '#c084fc', background: 'rgba(88,28,135,0.2)', padding: '3px 6px', borderRadius: '3px', flex: 1 },
  envNote: { fontFamily: font, fontSize: '5px', color: '#4c1d95', letterSpacing: '0.3px', lineHeight: 1.8 },

  previewCard: { background: 'rgba(88,28,135,0.06)', border: '1px solid #3b0764', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' },
  previewLabel: { fontFamily: font, fontSize: '5px', letterSpacing: '1.5px', color: '#4c1d95' },

  createSection: { display: 'flex', flexDirection: 'column', gap: '8px' },
  createNote: { fontFamily: font, fontSize: '5px', color: '#3b0764', letterSpacing: '0.3px', textAlign: 'center' as const },

  // Action button
  actionBtn: { width: '100%', padding: '14px', background: 'linear-gradient(135deg,#7c3aed 0%,#db2777 100%)', border: 'none', borderRadius: '8px', color: '#fff', fontFamily: font, fontSize: '8px', letterSpacing: '2px', cursor: 'pointer', boxShadow: '0 0 16px rgba(124,58,237,0.4)' },
  actionBtnWarn: { background: 'linear-gradient(135deg,#d97706 0%,#ef4444 100%)', boxShadow: '0 0 16px rgba(239,68,68,0.3)', fontSize: '7px' },
  actionBtnBusy: { opacity: 0.6, cursor: 'not-allowed', boxShadow: 'none' },

  // Tx result
  txResult: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'rgba(34,197,94,0.06)', border: '1px solid #166534', borderRadius: '6px', flexWrap: 'wrap' as const },
  txResultLabel: { fontFamily: font, fontSize: '6px', color: '#22c55e', flexShrink: 0 },
  txLink: { fontFamily: font, fontSize: '6px', color: '#22c55e', textDecoration: 'none', flex: 1 },

  harvestResult: { display: 'flex', flexDirection: 'column', gap: '6px' },
  harvestTitle: { fontFamily: font, fontSize: '7px', color: '#22c55e', letterSpacing: '1px' },

  emptyHarvest: { fontFamily: font, fontSize: '6px', color: '#4c1d95', letterSpacing: '0.3px', padding: '8px', textAlign: 'center' as const },

  copyBtn: { fontFamily: font, fontSize: '5px', letterSpacing: '1px', color: '#c084fc', background: 'transparent', border: '1px solid #3b0764', borderRadius: '4px', padding: '3px 7px', cursor: 'pointer', flexShrink: 0 },

  // Error
  errorBox: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px', background: 'rgba(239,68,68,0.06)', border: '1px solid #7f1d1d', borderRadius: '6px', flexWrap: 'wrap' as const },
  errorText: { fontFamily: font, fontSize: '5.5px', color: '#fca5a5', letterSpacing: '0.3px', lineHeight: 1.8, flex: 1, wordBreak: 'break-word' as const },
  retryBtn: { fontFamily: font, fontSize: '6px', color: '#ef4444', background: 'transparent', border: '1px solid #7f1d1d', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', flexShrink: 0 },

  // Fee card
  feeCard: { background: 'rgba(13,0,32,0.9)', border: '1px solid #1e0035', borderRadius: '12px', padding: '16px' },
  feeTitle: { fontFamily: font, fontSize: '6px', letterSpacing: '2px', color: '#3b0764', marginBottom: '12px' },
  feeGrid: { display: 'flex', flexDirection: 'column', gap: '8px' },
  feeRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' },
  feeLabel: { fontFamily: font, fontSize: '5.5px', color: '#4c1d95', letterSpacing: '0.5px', flex: 1 },
  feeValue: { fontFamily: font, fontSize: '7px', color: '#c084fc', textAlign: 'right' as const },
  feeNote: { fontFamily: font, fontSize: '4.5px', color: '#3b0764', textAlign: 'right' as const, letterSpacing: '0.3px' },

  // Warning
  warning: { display: 'flex', gap: '10px', padding: '12px', background: 'rgba(245,158,11,0.05)', border: '1px solid #78350f', borderRadius: '8px', alignItems: 'flex-start' },
  warningIcon: { fontFamily: font, fontSize: '10px', color: '#f59e0b', flexShrink: 0 },
  warningText: { fontFamily: font, fontSize: '5.5px', color: '#92400e', letterSpacing: '0.3px', lineHeight: 1.8 },
};
