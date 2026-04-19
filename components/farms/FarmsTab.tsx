'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js';
import {
  getLaunchpadPoolStatus,
  getCpmmPoolForToken,
  createRaydiumFarm,
  stakeLp,
  unstakeLp,
  harvestRewards,
  getFarmInfo,
  getUserFarmPosition,
  RewardType,
  type LaunchpadPoolStatus,
  type FormatFarmInfoOut,
  type UserFarmPosition,
  type FarmRewardInfo,
} from '@/services/raydiumFarm';
import type { ApiV3PoolInfoStandardItemCpmm } from '@raydium-io/raydium-sdk-v2';

const font = "'Geist', -apple-system, BlinkMacSystemFont, sans-serif";
const pressStart = 'var(--font-press-start), "Courier New", monospace';

const IS_DEVNET = process.env.NEXT_PUBLIC_LAUNCH_NETWORK === 'devnet';
const RPC_URL = IS_DEVNET
  ? 'https://api.devnet.solana.com'
  : (process.env.NEXT_PUBLIC_RPC_URL ?? 'https://mainnet.helius-rpc.com/?api-key=229cc849-fb9c-4ef0-968a-a0402480d121');

const DECIMALS = 6;

function fmtRaw(raw: BN | null | undefined, decimals = DECIMALS): string {
  if (!raw) return '—';
  try {
    const n = raw.toNumber() / 10 ** decimals;
    return n.toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 2 });
  } catch {
    return '—';
  }
}

function farmStorageKey(tokenMint: string) {
  return `basedfarms_farmId_${tokenMint}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function FarmsTab({ tokenMint }: { tokenMint: string }) {
  const wallet = useWallet();

  // Pool / farm state
  const [poolStatus, setPoolStatus] = useState<LaunchpadPoolStatus | null>(null);
  const [cpmmPool, setCpmmPool] = useState<ApiV3PoolInfoStandardItemCpmm | null>(null);
  const [farmId, setFarmId] = useState<string | null>(null);
  const [farmInfo, setFarmInfo] = useState<FormatFarmInfoOut | null>(null);
  const [userPosition, setUserPosition] = useState<UserFarmPosition | null>(null);
  const [lpBalance, setLpBalance] = useState<BN>(new BN(0));

  // UI state
  const [loading, setLoading] = useState(true);
  const [txStatus, setTxStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [txPending, setTxPending] = useState(false);

  // Create farm form
  const [createForm, setCreateForm] = useState({
    tokensPerDay: '',
    durationDays: '30',
  });

  // Clear tx status after 8 s
  useEffect(() => {
    if (!txStatus) return;
    const t = setTimeout(() => setTxStatus(null), 8000);
    return () => clearTimeout(t);
  }, [txStatus]);

  // Load persisted farmId from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(farmStorageKey(tokenMint));
    if (saved) setFarmId(saved);
  }, [tokenMint]);

  // Refresh all on-chain data
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Pool status
      const ps = await getLaunchpadPoolStatus(tokenMint);
      setPoolStatus(ps);

      if (!ps || ps.status < 2) {
        setCpmmPool(null);
        setFarmInfo(null);
        setUserPosition(null);
        return;
      }

      // 2. CPMM pool (post-migration)
      const pool = await getCpmmPoolForToken(tokenMint);
      setCpmmPool(pool);

      // 3. Farm info (if farmId is known)
      const storedId = typeof window !== 'undefined'
        ? localStorage.getItem(farmStorageKey(tokenMint))
        : null;
      const currentFarmId = farmId ?? storedId;

      if (currentFarmId) {
        const info = await getFarmInfo(currentFarmId);
        setFarmInfo(info);

        // 4. User position + LP balance
        if (wallet.publicKey && info) {
          const [pos, balance] = await Promise.all([
            getUserFarmPosition(info.id, info.programId, wallet.publicKey),
            fetchLpBalance(pool?.lpMint?.address ?? '', wallet.publicKey),
          ]);
          setUserPosition(pos);
          setLpBalance(balance);
        }
      }
    } catch (e) {
      console.error('[FarmsTab] refresh error:', e);
    } finally {
      setLoading(false);
    }
  }, [tokenMint, farmId, wallet.publicKey]);

  useEffect(() => { refresh(); }, [refresh]);

  // ─── LP balance helper ─────────────────────────────────────────────────

  async function fetchLpBalance(lpMintAddr: string, owner: PublicKey): Promise<BN> {
    if (!lpMintAddr) return new BN(0);
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const lpMint = new PublicKey(lpMintAddr);
      const ata = getAssociatedTokenAddressSync(lpMint, owner);
      const acct = await connection.getTokenAccountBalance(ata);
      return new BN(acct.value.amount);
    } catch {
      return new BN(0);
    }
  }

  // ─── Create farm ──────────────────────────────────────────────────────

  const handleCreateFarm = async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !cpmmPool) return;
    const tokensPerDay = parseFloat(createForm.tokensPerDay);
    const durationDays = parseFloat(createForm.durationDays);
    if (!tokensPerDay || tokensPerDay <= 0 || !durationDays || durationDays < 1) {
      setTxStatus({ msg: 'Enter valid reward rate and duration', ok: false });
      return;
    }

    setCreating(true);
    setTxStatus({ msg: 'Deploying farm…', ok: true });
    try {
      const perSecond = (tokensPerDay * 10 ** DECIMALS / 86400).toFixed(0);
      const openTime = Math.floor(Date.now() / 1000) + 60;
      const endTime  = openTime + Math.round(durationDays * 86400);

      const rewardInfos: FarmRewardInfo[] = [{
        mint: new PublicKey(tokenMint),
        perSecond,
        openTime,
        endTime,
        rewardType: 'Standard SPL' as import('@raydium-io/raydium-sdk-v2').RewardType,
      }];

      const poolInfo = cpmmPool as unknown as import('@raydium-io/raydium-sdk-v2').ApiV3PoolInfoStandardItem;

      const { farmId: newFarmId, txId } = await createRaydiumFarm({
        poolInfo,
        rewardInfos,
        userPublicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction as (tx: import('@solana/web3.js').Transaction) => Promise<import('@solana/web3.js').Transaction>,
      });

      // Persist farmId
      if (typeof window !== 'undefined') {
        localStorage.setItem(farmStorageKey(tokenMint), newFarmId);
      }
      setFarmId(newFarmId);
      setTxStatus({ msg: `Farm deployed! tx: ${txId.slice(0, 8)}…`, ok: true });
      setShowCreate(false);
      setCreateForm({ tokensPerDay: '', durationDays: '30' });
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxStatus({ msg: `Error: ${msg.slice(0, 60)}`, ok: false });
    } finally {
      setCreating(false);
    }
  };

  // ─── Stake ────────────────────────────────────────────────────────────

  const handleStake = async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !farmInfo) return;
    const amtFloat = parseFloat(stakeAmount);
    if (!amtFloat || amtFloat <= 0) return;
    const amount = new BN(Math.floor(amtFloat * 10 ** DECIMALS).toString());

    setTxPending(true);
    setTxStatus({ msg: 'Staking LP…', ok: true });
    try {
      const { txId } = await stakeLp({
        farmInfo,
        amount,
        userPublicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction as (tx: import('@solana/web3.js').Transaction) => Promise<import('@solana/web3.js').Transaction>,
      });
      setTxStatus({ msg: `Staked! tx: ${txId.slice(0, 8)}…`, ok: true });
      setStakeAmount('');
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxStatus({ msg: `Error: ${msg.slice(0, 60)}`, ok: false });
    } finally {
      setTxPending(false);
    }
  };

  // ─── Unstake ──────────────────────────────────────────────────────────

  const handleUnstake = async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !farmInfo) return;
    const amtFloat = parseFloat(unstakeAmount);
    if (!amtFloat || amtFloat <= 0) return;
    const amount = new BN(Math.floor(amtFloat * 10 ** DECIMALS).toString());

    setTxPending(true);
    setTxStatus({ msg: 'Unstaking LP…', ok: true });
    try {
      const { txId } = await unstakeLp({
        farmInfo,
        amount,
        userPublicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction as (tx: import('@solana/web3.js').Transaction) => Promise<import('@solana/web3.js').Transaction>,
      });
      setTxStatus({ msg: `Unstaked! tx: ${txId.slice(0, 8)}…`, ok: true });
      setUnstakeAmount('');
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxStatus({ msg: `Error: ${msg.slice(0, 60)}`, ok: false });
    } finally {
      setTxPending(false);
    }
  };

  // ─── Harvest ──────────────────────────────────────────────────────────

  const handleHarvest = async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !farmInfo) return;

    setTxPending(true);
    setTxStatus({ msg: 'Claiming rewards…', ok: true });
    try {
      const { txId } = await harvestRewards({
        farmInfo,
        userPublicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction as (tx: import('@solana/web3.js').Transaction) => Promise<import('@solana/web3.js').Transaction>,
      });
      setTxStatus({ msg: `Claimed! tx: ${txId.slice(0, 8)}…`, ok: true });
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxStatus({ msg: `Error: ${msg.slice(0, 60)}`, ok: false });
    } finally {
      setTxPending(false);
    }
  };

  // ─── Derived values ────────────────────────────────────────────────────

  const connected = !!wallet.publicKey;
  const deposited = userPosition?.deposited ?? new BN(0);
  const hasStaked = !deposited.isZero();
  const lpBalanceDisplay = fmtRaw(lpBalance, 9); // LP tokens typically 9 decimals
  const depositedDisplay = fmtRaw(deposited, 9);

  // ─── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={s.centered}>
        <div style={s.spinner}>◈</div>
        <span style={s.loadingText}>LOADING…</span>
      </div>
    );
  }

  // No pool found
  if (!poolStatus) {
    return (
      <div style={s.emptyCard}>
        <div style={s.emptyIcon}>◈</div>
        <div style={s.emptyTitle}>NO LAUNCHPAD POOL FOUND</div>
        <div style={s.emptyBody}>This token has no active LaunchLab pool.</div>
      </div>
    );
  }

  // Pre-graduation: show bonding progress
  if (poolStatus.status < 2) {
    const pct = Math.min(poolStatus.pct, 100);
    return (
      <div style={s.wrap}>
        <div style={s.graduationCard}>
          <div style={s.gradTitle}>
            {poolStatus.status === 1 ? 'MIGRATING TO RAYDIUM…' : 'BONDING CURVE ACTIVE'}
          </div>
          <div style={s.gradSubtitle}>
            Farms unlock when this token graduates to Raydium CPMM
          </div>

          {/* Progress bar */}
          <div style={s.progressWrap}>
            <div style={s.progressBar}>
              <div style={{ ...s.progressFill, width: `${pct}%` }} />
            </div>
            <div style={s.progressLabel}>
              {pct.toFixed(1)}% · {poolStatus.raisedSol.toFixed(2)} / {poolStatus.targetSol.toFixed(2)} SOL
            </div>
          </div>

          <div style={s.gradHint}>
            {poolStatus.targetSol - poolStatus.raisedSol > 0
              ? `${(poolStatus.targetSol - poolStatus.raisedSol).toFixed(2)} SOL remaining to graduation`
              : 'Migration in progress'}
          </div>
        </div>
      </div>
    );
  }

  // Post-graduation, no CPMM pool found yet
  if (!cpmmPool) {
    return (
      <div style={s.emptyCard}>
        <div style={s.emptyIcon}>◈</div>
        <div style={s.emptyTitle}>CPMM POOL LOADING</div>
        <div style={s.emptyBody}>This token has graduated. Waiting for CPMM pool to appear.</div>
        <button style={s.refreshBtn} onClick={refresh}>↻ REFRESH</button>
      </div>
    );
  }

  // Post-graduation, no farm deployed
  if (!farmInfo) {
    return (
      <div style={s.wrap}>
        {txStatus && (
          <div style={{ ...s.toast, borderColor: txStatus.ok ? '#f97316' : '#ef4444' }}>
            <span style={{ color: txStatus.ok ? '#f97316' : '#ef4444' }}>{txStatus.msg}</span>
          </div>
        )}

        <div style={s.emptyCard}>
          <div style={s.emptyIcon}>◈</div>
          <div style={s.emptyTitle}>TOKEN GRADUATED</div>
          <div style={s.emptyBody}>
            Deploy an LP staking farm to incentivize liquidity providers.
            You fund the rewards from your wallet after deployment.
            {!connected && ' Connect your wallet to continue.'}
          </div>
          {connected && (
            <button style={s.deployBtn} onClick={() => setShowCreate(true)}>
              + DEPLOY LP FARM
            </button>
          )}
        </div>

        {showCreate && (
          <CreateModal
            tokenMint={tokenMint}
            form={createForm}
            creating={creating}
            onFormChange={setCreateForm}
            onDeploy={handleCreateFarm}
            onClose={() => setShowCreate(false)}
          />
        )}
      </div>
    );
  }

  // Full staking UI
  return (
    <div style={s.wrap}>
      {/* TX toast */}
      {txStatus && (
        <div style={{ ...s.toast, borderColor: txStatus.ok ? '#f97316' : '#ef4444' }}>
          <span style={{ color: txStatus.ok ? '#f97316' : '#ef4444' }}>{txStatus.msg}</span>
        </div>
      )}

      {/* Farm card */}
      <div style={s.farmCard}>
        {/* Header */}
        <div style={s.farmHeader}>
          <div style={s.farmTitle}>◈ FARM</div>
          <div style={s.farmMeta}>
            <span style={s.farmMetaKey}>FARM ID</span>
            <span style={s.farmMetaVal}>
              {farmInfo.id.slice(0, 6)}…{farmInfo.id.slice(-4)}
            </span>
          </div>
          <button style={s.smallRefreshBtn} onClick={refresh} title="Refresh">↻</button>
        </div>

        {/* Your position */}
        <div style={s.section}>
          <div style={s.sectionTitle}>YOUR POSITION</div>

          {!connected ? (
            <div style={s.connectNote}>Connect wallet to stake LP</div>
          ) : (
            <>
              <div style={s.posRow}>
                <div style={s.posItem}>
                  <span style={s.posLabel}>STAKED LP</span>
                  <span style={s.posValue}>{depositedDisplay}</span>
                </div>
                <div style={s.posItem}>
                  <span style={s.posLabel}>LP BALANCE</span>
                  <span style={s.posValue}>{lpBalanceDisplay}</span>
                </div>
              </div>

              {/* Stake */}
              <div style={s.inputRow}>
                <input
                  type="number"
                  placeholder="Amount to stake"
                  value={stakeAmount}
                  onChange={e => setStakeAmount(e.target.value)}
                  style={s.amountInput}
                  disabled={txPending}
                />
                <button
                  style={s.maxBtn}
                  onClick={() => setStakeAmount(
                    (lpBalance.toNumber() / 10 ** 9).toFixed(6)
                  )}
                  disabled={txPending}
                >
                  MAX
                </button>
                <button
                  style={{
                    ...s.actionBtn,
                    ...(!stakeAmount || parseFloat(stakeAmount) <= 0 || txPending ? s.actionBtnDisabled : {}),
                  }}
                  onClick={handleStake}
                  disabled={!stakeAmount || parseFloat(stakeAmount) <= 0 || txPending}
                >
                  STAKE
                </button>
              </div>

              {/* Unstake */}
              <div style={s.inputRow}>
                <input
                  type="number"
                  placeholder="Amount to unstake"
                  value={unstakeAmount}
                  onChange={e => setUnstakeAmount(e.target.value)}
                  style={s.amountInput}
                  disabled={txPending}
                />
                <button
                  style={s.maxBtn}
                  onClick={() => setUnstakeAmount(
                    (deposited.toNumber() / 10 ** 9).toFixed(6)
                  )}
                  disabled={txPending || !hasStaked}
                >
                  MAX
                </button>
                <button
                  style={{
                    ...s.actionBtn,
                    ...(!unstakeAmount || parseFloat(unstakeAmount) <= 0 || !hasStaked || txPending ? s.actionBtnDisabled : {}),
                  }}
                  onClick={handleUnstake}
                  disabled={!unstakeAmount || parseFloat(unstakeAmount) <= 0 || !hasStaked || txPending}
                >
                  UNSTAKE
                </button>
              </div>

              {/* Harvest */}
              <button
                style={{
                  ...s.claimBtn,
                  ...(!hasStaked || txPending ? s.claimBtnDisabled : {}),
                }}
                onClick={handleHarvest}
                disabled={!hasStaked || txPending}
              >
                CLAIM REWARDS
              </button>
            </>
          )}
        </div>

        {/* Farm stats */}
        <div style={s.section}>
          <div style={s.sectionTitle}>FARM STATS</div>
          <div style={s.statsGrid}>
            <div style={s.statItem}>
              <span style={s.statLabel}>APR</span>
              <span style={{ ...s.statValue, color: '#f97316' }}>
                {farmInfo.apr ? `${farmInfo.apr.toFixed(1)}%` : '—'}
              </span>
            </div>
            <div style={s.statItem}>
              <span style={s.statLabel}>TVL</span>
              <span style={s.statValue}>
                {farmInfo.tvl ? `$${farmInfo.tvl.toLocaleString()}` : '—'}
              </span>
            </div>
            <div style={s.statItem}>
              <span style={s.statLabel}>LP MINT</span>
              <span style={{ ...s.statValue, fontSize: '10px' }}>
                {farmInfo.lpMint.address.slice(0, 6)}…{farmInfo.lpMint.address.slice(-4)}
              </span>
            </div>
            <div style={s.statItem}>
              <span style={s.statLabel}>REWARDS</span>
              <span style={s.statValue}>{farmInfo.rewardInfos.length} token(s)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Create farm modal ────────────────────────────────────────────────────────

interface CreateModalProps {
  tokenMint: string;
  form: { tokensPerDay: string; durationDays: string };
  creating: boolean;
  onFormChange: (f: { tokensPerDay: string; durationDays: string }) => void;
  onDeploy: () => void;
  onClose: () => void;
}

function CreateModal({ tokenMint, form, creating, onFormChange, onDeploy, onClose }: CreateModalProps) {
  const perSecDisplay = form.tokensPerDay
    ? (parseFloat(form.tokensPerDay) / 86400).toFixed(6)
    : '—';

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.modalTitle}>DEPLOY LP FARM</div>
        <div style={s.modalSubtitle}>Raydium V6 permissionless farm · LP holders earn rewards</div>

        <div style={s.modalField}>
          <label style={s.modalLabel}>REWARD TOKEN</label>
          <div style={s.modalStatic}>
            {tokenMint.slice(0, 8)}…{tokenMint.slice(-8)}
            <span style={{ color: '#555555', marginLeft: '8px' }}>(this token)</span>
          </div>
        </div>

        <div style={s.modalField}>
          <label style={s.modalLabel}>REWARD RATE (tokens / day)</label>
          <input
            type="number"
            placeholder="e.g. 10000"
            value={form.tokensPerDay}
            onChange={e => onFormChange({ ...form, tokensPerDay: e.target.value })}
            style={s.modalInput}
            disabled={creating}
          />
          <span style={s.modalHint}>Per second: {perSecDisplay}</span>
        </div>

        <div style={s.modalField}>
          <label style={s.modalLabel}>DURATION (days)</label>
          <input
            type="number"
            placeholder="e.g. 30"
            value={form.durationDays}
            onChange={e => onFormChange({ ...form, durationDays: e.target.value })}
            style={s.modalInput}
            disabled={creating}
            min={1}
          />
          <span style={s.modalHint}>
            Farm ends in {form.durationDays || '—'} days
            · Total reward: {form.tokensPerDay && form.durationDays
              ? (parseFloat(form.tokensPerDay) * parseFloat(form.durationDays)).toLocaleString()
              : '—'} tokens
          </span>
        </div>

        <div style={s.modalNote}>
          You are the farm authority. Fund the reward vault before rewards begin.
          Farm starts 60 seconds after deployment.
        </div>

        <div style={s.modalActions}>
          <button style={s.cancelBtn} onClick={onClose} disabled={creating}>CANCEL</button>
          <button
            style={{ ...s.deployModalBtn, ...(creating ? s.deployModalBtnDisabled : {}) }}
            onClick={onDeploy}
            disabled={creating || !form.tokensPerDay || !form.durationDays}
          >
            {creating ? 'DEPLOYING…' : 'DEPLOY FARM'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    fontFamily: font,
    fontSize: '12px',
  },
  centered: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '40px 0',
  },
  spinner: {
    fontSize: '24px',
    color: '#444444',
  },
  loadingText: {
    color: '#555555',
    fontSize: '11px',
    letterSpacing: '0.5px',
    fontFamily: font,
  },
  toast: {
    padding: '10px 14px',
    background: '#111111',
    border: '1px solid #333333',
    borderRadius: '8px',
    fontSize: '12px',
    letterSpacing: '0.3px',
    fontFamily: font,
  },
  emptyCard: {
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '12px',
    padding: '36px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
    textAlign: 'center',
    fontFamily: font,
  },
  emptyIcon: {
    fontSize: '28px',
    color: '#333333',
  },
  emptyTitle: {
    color: '#888888',
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.5px',
  },
  emptyBody: {
    color: '#555555',
    fontSize: '11px',
    lineHeight: '1.7',
    letterSpacing: '0.3px',
    maxWidth: '300px',
  },
  refreshBtn: {
    background: 'transparent',
    border: '1px solid #222222',
    borderRadius: '6px',
    color: '#555555',
    fontSize: '12px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: font,
    letterSpacing: '0.3px',
    marginTop: '4px',
  },

  // Graduation card
  graduationCard: {
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '12px',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    fontFamily: font,
  },
  gradTitle: {
    fontFamily: pressStart,
    color: '#f97316',
    fontSize: '9px',
    letterSpacing: '1px',
  },
  gradSubtitle: {
    color: '#666666',
    fontSize: '11px',
    letterSpacing: '0.3px',
    lineHeight: '1.6',
  },
  progressWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  progressBar: {
    width: '100%',
    height: '6px',
    background: '#1a1a1a',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#f97316',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  progressLabel: {
    color: '#888888',
    fontSize: '11px',
    letterSpacing: '0.3px',
  },
  gradHint: {
    color: '#555555',
    fontSize: '11px',
    letterSpacing: '0.3px',
  },

  // Farm card
  farmCard: {
    background: '#111111',
    border: '1px solid #1a1a1a',
    borderRadius: '12px',
    overflow: 'hidden',
  },
  farmHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid #1a1a1a',
    background: '#0f0f0f',
  },
  farmTitle: {
    fontFamily: pressStart,
    color: '#f97316',
    fontSize: '9px',
    letterSpacing: '1px',
  },
  farmMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flex: 1,
    justifyContent: 'center',
  },
  farmMetaKey: {
    color: '#555555',
    fontSize: '10px',
    letterSpacing: '0.5px',
  },
  farmMetaVal: {
    color: '#888888',
    fontSize: '10px',
    letterSpacing: '0.5px',
  },
  smallRefreshBtn: {
    background: 'transparent',
    border: 'none',
    color: '#444444',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },

  // Sections
  section: {
    padding: '14px 16px',
    borderBottom: '1px solid #0f0f0f',
  },
  sectionTitle: {
    color: '#888888',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.5px',
    marginBottom: '12px',
    paddingBottom: '6px',
    borderBottom: '1px solid #1a1a1a',
  },
  connectNote: {
    color: '#555555',
    fontSize: '12px',
    letterSpacing: '0.3px',
    textAlign: 'center',
    padding: '12px 0',
  },

  // Position
  posRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px',
    marginBottom: '14px',
  },
  posItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  posLabel: {
    color: '#555555',
    fontSize: '10px',
    letterSpacing: '0.5px',
  },
  posValue: {
    color: '#ffffff',
    fontSize: '13px',
    letterSpacing: '0.3px',
    fontWeight: '500',
  },

  // Inputs
  inputRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginBottom: '8px',
  },
  amountInput: {
    fontFamily: font,
    fontSize: '12px',
    flex: 1,
    background: '#0f0f0f',
    border: '1px solid #222222',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#ffffff',
    outline: 'none',
    letterSpacing: '0.3px',
  },
  maxBtn: {
    fontFamily: font,
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.3px',
    padding: '6px 8px',
    background: '#1a1a1a',
    border: '1px solid #333333',
    borderRadius: '5px',
    color: '#888888',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  actionBtn: {
    fontFamily: font,
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.3px',
    padding: '7px 12px',
    background: '#f97316',
    border: 'none',
    borderRadius: '6px',
    color: '#000000',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  actionBtnDisabled: {
    background: '#1a1a1a',
    color: '#333333',
    cursor: 'not-allowed',
  },
  claimBtn: {
    fontFamily: font,
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.3px',
    padding: '10px',
    width: '100%',
    background: '#f97316',
    border: 'none',
    borderRadius: '7px',
    color: '#000000',
    cursor: 'pointer',
    marginTop: '4px',
  },
  claimBtnDisabled: {
    background: '#1a1a1a',
    color: '#333333',
    cursor: 'not-allowed',
  },

  // Stats
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statLabel: {
    color: '#555555',
    fontSize: '10px',
    letterSpacing: '0.5px',
  },
  statValue: {
    color: '#e5e5e5',
    fontSize: '12px',
    letterSpacing: '0.3px',
    fontWeight: '500',
  },

  // Deploy button (in empty state)
  deployBtn: {
    fontFamily: font,
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.5px',
    padding: '10px 18px',
    background: '#f97316',
    border: 'none',
    borderRadius: '8px',
    color: '#000000',
    cursor: 'pointer',
    marginTop: '4px',
  },

  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '16px',
  },
  modal: {
    background: '#111111',
    border: '1px solid #222222',
    borderRadius: '14px',
    padding: '24px 20px',
    width: '100%',
    maxWidth: '420px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    fontFamily: font,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '700',
    letterSpacing: '1px',
  },
  modalSubtitle: {
    color: '#555555',
    fontSize: '11px',
    letterSpacing: '0.3px',
    marginTop: '-8px',
  },
  modalField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  modalLabel: {
    color: '#888888',
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.5px',
  },
  modalStatic: {
    color: '#e5e5e5',
    fontSize: '11px',
    letterSpacing: '0.3px',
    background: '#0f0f0f',
    border: '1px solid #1a1a1a',
    borderRadius: '6px',
    padding: '8px 10px',
    wordBreak: 'break-all',
  },
  modalInput: {
    fontFamily: font,
    fontSize: '12px',
    background: '#0f0f0f',
    border: '1px solid #333333',
    borderRadius: '6px',
    padding: '9px 12px',
    color: '#ffffff',
    outline: 'none',
    letterSpacing: '0.3px',
  },
  modalHint: {
    color: '#555555',
    fontSize: '10px',
    letterSpacing: '0.3px',
  },
  modalNote: {
    color: '#555555',
    fontSize: '11px',
    letterSpacing: '0.3px',
    lineHeight: '1.7',
    background: '#0f0f0f',
    borderRadius: '6px',
    padding: '8px 10px',
    border: '1px solid #1a1a1a',
  },
  modalActions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    marginTop: '4px',
  },
  cancelBtn: {
    fontFamily: font,
    fontSize: '12px',
    letterSpacing: '0.3px',
    padding: '9px 14px',
    background: 'transparent',
    border: '1px solid #333333',
    borderRadius: '7px',
    color: '#888888',
    cursor: 'pointer',
  },
  deployModalBtn: {
    fontFamily: font,
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.5px',
    padding: '9px 18px',
    background: '#f97316',
    border: 'none',
    borderRadius: '7px',
    color: '#000000',
    cursor: 'pointer',
  },
  deployModalBtnDisabled: {
    background: '#1a1a1a',
    color: '#333333',
    cursor: 'not-allowed',
  },
};
