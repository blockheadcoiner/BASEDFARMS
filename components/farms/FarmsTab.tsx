'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  FarmAccount,
  StakePositionData,
  FarmStateData,
  fetchFarmsForMint,
  fetchStakePosition,
  fetchRewardVaultBalance,
  fetchUserTokenBalance,
  computePendingRewards,
  createFarm,
  stakeFarm,
  unstakeFarm,
  claimRewardsFarm,
  type AnchorWallet,
} from '@/lib/farmClient';

const DECIMALS = 6;
const font = 'var(--font-press-start), "Courier New", monospace';

// ─── Formatting helpers ─────────────────────────────────────────────────────

function fmtBn(bn: BN | null | undefined): string {
  if (!bn) return '—';
  try {
    const n = bn.toNumber();
    const display = n / 10 ** DECIMALS;
    return display.toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 2 });
  } catch {
    return '—';
  }
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4, minimumFractionDigits: 2 });
}

function shortKey(pk: PublicKey): string {
  const s = pk.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function daysHoursLabel(seconds: number): string {
  if (seconds <= 0) return 'Unlocked';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface FarmRowState {
  position: StakePositionData | null;
  vaultBalance: number;
  stakeAmount: string;
  unstakeAmount: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function FarmsTab({ tokenMint }: { tokenMint: string }) {
  const wallet = useWallet();
  const mintPubkey = useMemo(() => new PublicKey(tokenMint), [tokenMint]);

  const [farms, setFarms] = useState<FarmAccount[]>([]);
  const [rowState, setRowState] = useState<Record<string, FarmRowState>>({});
  const [userBalance, setUserBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [txStatus, setTxStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ ratePerDay: '', lockDays: '0' });
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await fetchFarmsForMint(mintPubkey);
      setFarms(fetched);

      const newRowState: Record<string, FarmRowState> = {};
      for (const farm of fetched) {
        const key = farm.publicKey.toBase58();
        const vaultBalance = await fetchRewardVaultBalance(farm.publicKey);
        const position = wallet.publicKey
          ? await fetchStakePosition(farm.publicKey, wallet.publicKey)
          : null;
        newRowState[key] = {
          position,
          vaultBalance,
          stakeAmount: rowState[key]?.stakeAmount ?? '',
          unstakeAmount: rowState[key]?.unstakeAmount ?? '',
        };
      }
      setRowState(newRowState);

      if (wallet.publicKey) {
        setUserBalance(await fetchUserTokenBalance(mintPubkey, wallet.publicKey));
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintPubkey, wallet.publicKey]);

  useEffect(() => { refresh(); }, [refresh]);

  // Toast auto-clear
  useEffect(() => {
    if (!txStatus) return;
    const t = setTimeout(() => setTxStatus(null), 6000);
    return () => clearTimeout(t);
  }, [txStatus]);

  // ─── Action handlers ───────────────────────────────────────────────────

  const anchorWallet = useMemo((): AnchorWallet | null => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) return null;
    return {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction as AnchorWallet['signTransaction'],
      signAllTransactions: wallet.signAllTransactions as AnchorWallet['signAllTransactions'],
    };
  }, [wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

  const handleCreateFarm = async () => {
    if (!anchorWallet) return;
    const rateRaw = Math.round(parseFloat(createForm.ratePerDay) * 10 ** DECIMALS / 86400);
    const lockSecs = Math.round(parseFloat(createForm.lockDays) * 86400);
    if (!rateRaw || isNaN(rateRaw)) {
      setTxStatus({ msg: 'Enter a valid reward rate', ok: false });
      return;
    }
    setCreating(true);
    setTxStatus({ msg: 'Deploying farm...', ok: true });
    try {
      const sig = await createFarm(
        anchorWallet,
        mintPubkey,
        new BN(rateRaw),
        new BN(lockSecs)
      );
      setTxStatus({ msg: `Farm deployed! tx: ${sig.slice(0, 8)}…`, ok: true });
      setShowCreate(false);
      setCreateForm({ ratePerDay: '', lockDays: '0' });
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxStatus({ msg: `Error: ${msg.slice(0, 50)}`, ok: false });
    } finally {
      setCreating(false);
    }
  };

  const handleStake = async (farm: FarmAccount) => {
    if (!anchorWallet) return;
    const key = farm.publicKey.toBase58();
    const amtFloat = parseFloat(rowState[key]?.stakeAmount ?? '0');
    if (!amtFloat || amtFloat <= 0) return;
    const amtRaw = new BN(Math.floor(amtFloat * 10 ** DECIMALS).toString());
    setTxStatus({ msg: 'Staking...', ok: true });
    try {
      const sig = await stakeFarm(anchorWallet, farm.publicKey, farm.account.stakeMint, amtRaw);
      setTxStatus({ msg: `Staked! tx: ${sig.slice(0, 8)}…`, ok: true });
      setRowState(prev => ({ ...prev, [key]: { ...prev[key], stakeAmount: '' } }));
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxStatus({ msg: `Error: ${msg.slice(0, 50)}`, ok: false });
    }
  };

  const handleUnstake = async (farm: FarmAccount) => {
    if (!anchorWallet) return;
    const key = farm.publicKey.toBase58();
    const amtFloat = parseFloat(rowState[key]?.unstakeAmount ?? '0');
    if (!amtFloat || amtFloat <= 0) return;
    const amtRaw = new BN(Math.floor(amtFloat * 10 ** DECIMALS).toString());
    setTxStatus({ msg: 'Unstaking...', ok: true });
    try {
      const sig = await unstakeFarm(anchorWallet, farm.publicKey, farm.account.stakeMint, amtRaw);
      setTxStatus({ msg: `Unstaked! tx: ${sig.slice(0, 8)}…`, ok: true });
      setRowState(prev => ({ ...prev, [key]: { ...prev[key], unstakeAmount: '' } }));
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxStatus({ msg: `Error: ${msg.slice(0, 50)}`, ok: false });
    }
  };

  const handleClaim = async (farm: FarmAccount) => {
    if (!anchorWallet) return;
    setTxStatus({ msg: 'Claiming rewards...', ok: true });
    try {
      const sig = await claimRewardsFarm(anchorWallet, farm.publicKey, farm.account.rewardMint);
      setTxStatus({ msg: `Claimed! tx: ${sig.slice(0, 8)}…`, ok: true });
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTxStatus({ msg: `Error: ${msg.slice(0, 50)}`, ok: false });
    }
  };

  // ─── Stats helpers ─────────────────────────────────────────────────────

  function calcApy(farmData: FarmStateData): string | null {
    if (farmData.totalStaked.isZero()) return null;
    try {
      const rate = farmData.rewardRate.toNumber();
      const staked = farmData.totalStaked.toNumber();
      const apy = (rate * 86400 * 365 / staked) * 100;
      return apy > 99999 ? '>99999' : apy.toFixed(1);
    } catch {
      return null;
    }
  }

  function daysRemaining(farmData: FarmStateData, vaultBalance: number): string {
    try {
      const ratePerDay = farmData.rewardRate.toNumber() / 10 ** DECIMALS * 86400;
      if (ratePerDay <= 0) return '—';
      const days = vaultBalance / ratePerDay;
      return days < 1 ? `${Math.floor(days * 24)}h` : `${Math.floor(days)}d`;
    } catch {
      return '—';
    }
  }

  function unlockLabel(farmData: FarmStateData, position: StakePositionData | null): string {
    if (!position || position.amount.isZero()) return '—';
    try {
      const stakeTime = position.stakeTime.toNumber();
      const minDur = farmData.minStakeDuration.toNumber();
      const unlockAt = stakeTime + minDur;
      const secondsLeft = unlockAt - Math.floor(Date.now() / 1000);
      return daysHoursLabel(secondsLeft);
    } catch {
      return '—';
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const connected = !!wallet.publicKey;

  return (
    <div style={s.wrap}>
      {/* Devnet notice */}
      <div style={s.devnetBanner}>
        <span style={s.devnetBadge}>DEVNET</span>
        <span style={s.devnetText}>Farms run on Solana devnet. Switch your wallet to devnet.</span>
        <button style={s.refreshBtn} onClick={refresh} title="Refresh">↻</button>
      </div>

      {/* TX status toast */}
      {txStatus && (
        <div style={{ ...s.toast, borderColor: txStatus.ok ? '#7c3aed' : '#dc2626' }}>
          <span style={{ color: txStatus.ok ? '#a78bfa' : '#f87171' }}>{txStatus.msg}</span>
        </div>
      )}

      {/* Deploy Farm button */}
      {connected && (
        <button style={s.deployBtn} onClick={() => setShowCreate(true)}>
          + DEPLOY FARM
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div style={s.loadingWrap}>
          <div style={s.spinner}>◈</div>
          <span style={s.loadingText}>LOADING FARMS…</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && farms.length === 0 && (
        <div style={s.emptyCard}>
          <div style={s.emptyIcon}>◈</div>
          <div style={s.emptyTitle}>NO FARMS DEPLOYED YET</div>
          <div style={s.emptyBody}>
            No liquidity farms have been initialized for this token.
            {connected ? ' Click + DEPLOY FARM to create one.' : ' Connect your wallet to deploy.'}
          </div>
        </div>
      )}

      {/* Farm cards */}
      {!loading && farms.map((farm) => {
        const key = farm.publicKey.toBase58();
        const row = rowState[key];
        const position = row?.position ?? null;
        const vaultBalance = row?.vaultBalance ?? 0;
        const farmData = farm.account;

        const pending = position
          ? computePendingRewards(farmData, position)
          : null;

        const apy = calcApy(farmData);
        const daysLeft = daysRemaining(farmData, vaultBalance);
        const unlock = unlockLabel(farmData, position);

        const sharePercent = position && !farmData.totalStaked.isZero()
          ? (position.amount.toNumber() / farmData.totalStaked.toNumber() * 100).toFixed(2)
          : null;

        const canUnstake = position && !position.amount.isZero() &&
          unlock === 'Unlocked';

        return (
          <div key={key} style={s.farmCard}>
            {/* Farm header */}
            <div style={s.farmHeader}>
              <div style={s.farmTitle}>◈ FARM</div>
              <div style={s.farmMeta}>
                <span style={s.farmMetaKey}>AUTHORITY</span>
                <span style={s.farmMetaVal}>{shortKey(farmData.authority)}</span>
              </div>
            </div>

            {/* ── USER POSITION ── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>YOUR POSITION</div>

              {!connected ? (
                <div style={s.connectNote}>Connect wallet to stake</div>
              ) : (
                <>
                  <div style={s.posRow}>
                    <div style={s.posItem}>
                      <span style={s.posLabel}>STAKED</span>
                      <span style={s.posValue}>{fmtBn(position?.amount ?? new BN(0))}</span>
                    </div>
                    <div style={s.posItem}>
                      <span style={s.posLabel}>PENDING REWARDS</span>
                      <span style={{ ...s.posValue, color: '#e879f9' }}>{fmtBn(pending)}</span>
                    </div>
                    <div style={s.posItem}>
                      <span style={s.posLabel}>WALLET BALANCE</span>
                      <span style={s.posValue}>{fmtNum(userBalance)}</span>
                    </div>
                    <div style={s.posItem}>
                      <span style={s.posLabel}>UNLOCK IN</span>
                      <span style={{ ...s.posValue, color: unlock === 'Unlocked' ? '#4ade80' : '#c084fc' }}>
                        {unlock}
                      </span>
                    </div>
                  </div>

                  {/* Stake input */}
                  <div style={s.inputRow}>
                    <input
                      type="number"
                      placeholder="Amount to stake"
                      value={row?.stakeAmount ?? ''}
                      onChange={e => setRowState(prev => ({
                        ...prev,
                        [key]: { ...prev[key], stakeAmount: e.target.value },
                      }))}
                      style={s.amountInput}
                    />
                    <button
                      style={s.maxBtn}
                      onClick={() => setRowState(prev => ({
                        ...prev,
                        [key]: { ...prev[key], stakeAmount: userBalance.toFixed(4) },
                      }))}
                    >
                      MAX
                    </button>
                    <button
                      style={s.actionBtn}
                      onClick={() => handleStake(farm)}
                      disabled={!row?.stakeAmount || parseFloat(row.stakeAmount) <= 0}
                    >
                      STAKE
                    </button>
                  </div>

                  {/* Unstake input */}
                  <div style={s.inputRow}>
                    <input
                      type="number"
                      placeholder="Amount to unstake"
                      value={row?.unstakeAmount ?? ''}
                      onChange={e => setRowState(prev => ({
                        ...prev,
                        [key]: { ...prev[key], unstakeAmount: e.target.value },
                      }))}
                      style={s.amountInput}
                    />
                    <button
                      style={s.maxBtn}
                      onClick={() => setRowState(prev => ({
                        ...prev,
                        [key]: { ...prev[key], unstakeAmount: fmtBn(position?.amount ?? new BN(0)).replace(/,/g, '') },
                      }))}
                    >
                      MAX
                    </button>
                    <button
                      style={{
                        ...s.actionBtn,
                        ...(!canUnstake ? s.actionBtnDisabled : {}),
                      }}
                      onClick={() => handleUnstake(farm)}
                      disabled={!canUnstake || !row?.unstakeAmount || parseFloat(row.unstakeAmount) <= 0}
                    >
                      UNSTAKE
                    </button>
                  </div>

                  {/* Claim */}
                  <button
                    style={{
                      ...s.claimBtn,
                      ...((!pending || pending.isZero()) ? s.claimBtnDisabled : {}),
                    }}
                    onClick={() => handleClaim(farm)}
                    disabled={!pending || pending.isZero()}
                  >
                    CLAIM {fmtBn(pending)} REWARDS
                  </button>
                </>
              )}
            </div>

            {/* ── FARM STATS ── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>FARM STATS</div>
              <div style={s.statsGrid}>
                <div style={s.statItem}>
                  <span style={s.statLabel}>TOTAL STAKED</span>
                  <span style={s.statValue}>{fmtBn(farmData.totalStaked)}</span>
                </div>
                <div style={s.statItem}>
                  <span style={s.statLabel}>RATE / DAY</span>
                  <span style={s.statValue}>
                    {(() => {
                      try {
                        return fmtNum(farmData.rewardRate.toNumber() / 10 ** DECIMALS * 86400);
                      } catch { return '—'; }
                    })()}
                  </span>
                </div>
                <div style={s.statItem}>
                  <span style={s.statLabel}>APY</span>
                  <span style={{ ...s.statValue, color: '#e879f9' }}>
                    {apy ? `${apy}%` : '—'}
                  </span>
                </div>
                <div style={s.statItem}>
                  <span style={s.statLabel}>YOUR SHARE</span>
                  <span style={s.statValue}>{sharePercent ? `${sharePercent}%` : '—'}</span>
                </div>
                <div style={s.statItem}>
                  <span style={s.statLabel}>VAULT BALANCE</span>
                  <span style={s.statValue}>{fmtNum(vaultBalance)}</span>
                </div>
                <div style={s.statItem}>
                  <span style={s.statLabel}>REWARDS END IN</span>
                  <span style={{ ...s.statValue, color: '#fbbf24' }}>{daysLeft}</span>
                </div>
                <div style={s.statItem}>
                  <span style={s.statLabel}>MIN LOCK</span>
                  <span style={s.statValue}>
                    {(() => {
                      try {
                        const secs = farmData.minStakeDuration.toNumber();
                        return secs === 0 ? 'None' : daysHoursLabel(secs);
                      } catch { return '—'; }
                    })()}
                  </span>
                </div>
                <div style={s.statItem}>
                  <span style={s.statLabel}>FARM PDA</span>
                  <span style={{ ...s.statValue, fontSize: '7px' }}>{shortKey(farm.publicKey)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── CREATE FARM MODAL ── */}
      {showCreate && (
        <div style={s.modalOverlay} onClick={() => setShowCreate(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>DEPLOY FARM</div>
            <div style={s.modalSubtitle}>Single-sided staking · Devnet</div>

            <div style={s.modalField}>
              <label style={s.modalLabel}>STAKE / REWARD TOKEN</label>
              <div style={s.modalStatic}>{tokenMint.slice(0, 8)}…{tokenMint.slice(-8)}</div>
            </div>

            <div style={s.modalField}>
              <label style={s.modalLabel}>REWARD RATE (tokens / day)</label>
              <input
                type="number"
                placeholder="e.g. 1000"
                value={createForm.ratePerDay}
                onChange={e => setCreateForm(prev => ({ ...prev, ratePerDay: e.target.value }))}
                style={s.modalInput}
              />
              <span style={s.modalHint}>
                Per second: {createForm.ratePerDay
                  ? (parseFloat(createForm.ratePerDay) / 86400).toFixed(6)
                  : '—'}
              </span>
            </div>

            <div style={s.modalField}>
              <label style={s.modalLabel}>MIN LOCK DURATION (days)</label>
              <input
                type="number"
                placeholder="0 = no lock"
                value={createForm.lockDays}
                onChange={e => setCreateForm(prev => ({ ...prev, lockDays: e.target.value }))}
                style={s.modalInput}
              />
              <span style={s.modalHint}>
                {parseFloat(createForm.lockDays) > 0
                  ? `${parseFloat(createForm.lockDays) * 86400} seconds`
                  : 'No lock period'}
              </span>
            </div>

            <div style={s.modalNote}>
              You become the farm authority. Fund the reward vault after creation
              via the fund_rewards instruction.
            </div>

            <div style={s.modalActions}>
              <button
                style={s.cancelBtn}
                onClick={() => setShowCreate(false)}
                disabled={creating}
              >
                CANCEL
              </button>
              <button
                style={{
                  ...s.deployModalBtn,
                  ...(creating ? s.deployModalBtnDisabled : {}),
                }}
                onClick={handleCreateFarm}
                disabled={creating || !createForm.ratePerDay}
              >
                {creating ? 'DEPLOYING…' : 'DEPLOY FARM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
  },

  // Devnet banner
  devnetBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(124, 58, 237, 0.08)',
    border: '1px solid rgba(124, 58, 237, 0.25)',
    borderRadius: '8px',
    padding: '8px 12px',
  },
  devnetBadge: {
    background: '#4c1d95',
    color: '#c084fc',
    fontSize: '7px',
    letterSpacing: '1px',
    padding: '2px 6px',
    borderRadius: '4px',
    whiteSpace: 'nowrap' as const,
  },
  devnetText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: '7px',
    letterSpacing: '0.5px',
    flex: 1,
  },
  refreshBtn: {
    background: 'transparent',
    border: 'none',
    color: '#7c3aed',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '0 4px',
    fontFamily: font,
    lineHeight: 1,
  },

  // Toast
  toast: {
    padding: '10px 14px',
    background: 'rgba(13,0,32,0.95)',
    border: '1px solid #7c3aed',
    borderRadius: '8px',
    fontSize: '8px',
    letterSpacing: '1px',
  },

  // Deploy button
  deployBtn: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    padding: '10px 16px',
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    alignSelf: 'flex-end',
    boxShadow: '0 0 12px rgba(124, 58, 237, 0.35)',
  },

  // Loading
  loadingWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '32px 0',
  },
  spinner: {
    fontSize: '24px',
    color: '#7c3aed',
    animation: 'spin 2s linear infinite',
  },
  loadingText: {
    color: '#4c1d95',
    fontSize: '8px',
    letterSpacing: '2px',
  },

  // Empty state
  emptyCard: {
    background: 'linear-gradient(160deg, #0d0015 0%, #100020 100%)',
    border: '1px solid #3b0764',
    borderRadius: '12px',
    padding: '36px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
    textAlign: 'center',
  },
  emptyIcon: {
    fontSize: '28px',
    color: '#3b0764',
  },
  emptyTitle: {
    color: '#7c3aed',
    fontSize: '10px',
    letterSpacing: '2px',
  },
  emptyBody: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '8px',
    lineHeight: '1.8',
    letterSpacing: '0.5px',
    maxWidth: '280px',
  },

  // Farm card
  farmCard: {
    background: 'linear-gradient(160deg, #0d0015 0%, #100020 100%)',
    border: '1px solid rgba(124, 58, 237, 0.3)',
    borderRadius: '12px',
    overflow: 'hidden',
  },
  farmHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(124, 58, 237, 0.06)',
  },
  farmTitle: {
    color: '#e879f9',
    fontSize: '10px',
    letterSpacing: '2px',
    textShadow: '0 0 8px rgba(232,121,249,0.4)',
  },
  farmMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  farmMetaKey: {
    color: '#4c1d95',
    fontSize: '7px',
    letterSpacing: '1px',
  },
  farmMetaVal: {
    color: '#a855f7',
    fontSize: '7px',
    letterSpacing: '1px',
  },

  // Section
  section: {
    padding: '14px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  sectionTitle: {
    color: '#c084fc',
    fontSize: '8px',
    letterSpacing: '2px',
    marginBottom: '12px',
    paddingBottom: '6px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  connectNote: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: '8px',
    letterSpacing: '1px',
    textAlign: 'center',
    padding: '12px 0',
  },

  // Position grid
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
    color: '#4c1d95',
    fontSize: '7px',
    letterSpacing: '1px',
  },
  posValue: {
    color: '#ffffff',
    fontSize: '10px',
    letterSpacing: '0.5px',
  },

  // Input rows
  inputRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginBottom: '8px',
  },
  amountInput: {
    fontFamily: font,
    fontSize: '8px',
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(124,58,237,0.3)',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#ffffff',
    outline: 'none',
    letterSpacing: '0.5px',
  },
  maxBtn: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    padding: '6px 8px',
    background: 'rgba(124,58,237,0.15)',
    border: '1px solid rgba(124,58,237,0.3)',
    borderRadius: '5px',
    color: '#a855f7',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  actionBtn: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    padding: '7px 12px',
    background: 'linear-gradient(135deg, #6d28d9, #5b21b6)',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  actionBtnDisabled: {
    background: 'rgba(88,28,135,0.2)',
    color: '#3b0764',
    cursor: 'not-allowed',
  },

  // Claim button
  claimBtn: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    padding: '10px',
    width: '100%',
    background: 'linear-gradient(135deg, #db2777, #9d174d)',
    border: 'none',
    borderRadius: '7px',
    color: '#fff',
    cursor: 'pointer',
    marginTop: '4px',
    boxShadow: '0 0 10px rgba(219,39,119,0.3)',
  },
  claimBtnDisabled: {
    background: 'rgba(88,28,135,0.15)',
    color: '#3b0764',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },

  // Stats grid
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
    color: '#4c1d95',
    fontSize: '7px',
    letterSpacing: '1px',
  },
  statValue: {
    color: '#e2b4ff',
    fontSize: '9px',
    letterSpacing: '0.5px',
  },

  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '16px',
  },
  modal: {
    background: 'linear-gradient(160deg, #0d0015 0%, #130025 100%)',
    border: '1px solid rgba(219,39,119,0.4)',
    borderRadius: '14px',
    padding: '24px 20px',
    width: '100%',
    maxWidth: '420px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    boxShadow: '0 0 40px rgba(219,39,119,0.2)',
  },
  modalTitle: {
    color: '#e879f9',
    fontSize: '13px',
    letterSpacing: '3px',
    textShadow: '0 0 12px rgba(232,121,249,0.5)',
  },
  modalSubtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '7px',
    letterSpacing: '1px',
    marginTop: '-8px',
  },
  modalField: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  modalLabel: {
    color: '#e2b4ff',
    fontSize: '7px',
    letterSpacing: '1.5px',
  },
  modalStatic: {
    color: '#a855f7',
    fontSize: '8px',
    letterSpacing: '0.5px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(124,58,237,0.2)',
    borderRadius: '6px',
    padding: '8px 10px',
    wordBreak: 'break-all',
  },
  modalInput: {
    fontFamily: font,
    fontSize: '9px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(124,58,237,0.3)',
    borderRadius: '6px',
    padding: '9px 12px',
    color: '#ffffff',
    outline: 'none',
    letterSpacing: '0.5px',
  },
  modalHint: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '7px',
    letterSpacing: '0.5px',
  },
  modalNote: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: '7px',
    letterSpacing: '0.5px',
    lineHeight: '1.8',
    background: 'rgba(124,58,237,0.06)',
    borderRadius: '6px',
    padding: '8px 10px',
    border: '1px solid rgba(124,58,237,0.15)',
  },
  modalActions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    marginTop: '4px',
  },
  cancelBtn: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    padding: '9px 14px',
    background: 'transparent',
    border: '1px solid rgba(219,39,119,0.25)',
    borderRadius: '7px',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
  },
  deployModalBtn: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    padding: '9px 18px',
    background: 'linear-gradient(135deg, #db2777, #7c3aed)',
    border: 'none',
    borderRadius: '7px',
    color: '#fff',
    cursor: 'pointer',
    boxShadow: '0 0 12px rgba(219,39,119,0.35)',
  },
  deployModalBtnDisabled: {
    background: 'rgba(88,28,135,0.2)',
    color: '#4c1d95',
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
};
