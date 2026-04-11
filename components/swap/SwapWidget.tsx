'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  getRaydiumQuote,
  executeRaydiumSwap,
  getLaunchpadQuote,
  executeLaunchpadSwap,
  type NormalizedQuote,
} from '@/services/raydium';
import { useWalletModal } from '@/components/WalletProvider';

// ── Constants ────────────────────────────────────────────────────────────────
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PLATFORM_FEE_PCT = '0.3';
const DEFAULT_SLIPPAGE_BPS = 500; // 5%
// letsbonk.fun LaunchLab tokens always use 6 decimals
const LAUNCHPAD_TOKEN_DECIMALS = 6;

// ── Types ────────────────────────────────────────────────────────────────────
type Direction = 'buy' | 'sell';
type SlippageMode = '100' | '200' | '500' | '1000' | 'custom';

type SwapError =
  | 'POOL_NOT_FOUND'
  | 'NO_ROUTE'
  | 'NO_LIQUIDITY'
  | 'INSUFFICIENT_BALANCE'
  | 'TX_FAILED'
  | 'WALLET_NOT_CONNECTED'
  | null;

interface Props {
  tokenMint: string;
  tokenSymbol?: string;
  feeAccount?: string;
  onSwapComplete?: (txSignature: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatAmount(raw: string, decimals = 9): string {
  const n = Number(raw) / Math.pow(10, decimals);
  if (n === 0) return '0';
  if (n < 0.000001) return n.toExponential(4);
  if (n < 0.01) return n.toFixed(6);
  if (n < 1000) return n.toFixed(4);
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatPriceImpact(pct: string): { label: string; color: string } {
  const n = Math.abs(parseFloat(pct));
  if (n < 0.1) return { label: `${n.toFixed(2)}%`, color: '#a855f7' };
  if (n < 1) return { label: `${n.toFixed(2)}%`, color: '#f59e0b' };
  return { label: `${n.toFixed(2)}%`, color: '#ec4899' };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SwapWidget({ tokenMint, tokenSymbol = 'TOKEN', feeAccount, onSwapComplete }: Props) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();

  const [direction, setDirection] = useState<Direction>('buy');
  const [inputAmount, setInputAmount] = useState('');
  const [quote, setQuote] = useState<NormalizedQuote | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [swapError, setSwapError] = useState<SwapError>(null);
  const [swapErrorDetail, setSwapErrorDetail] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [swapSummary, setSwapSummary] = useState<{ input: string; output: string } | null>(null);

  // ── Slippage state ─────────────────────────────────────────────────────────
  const [slippageMode, setSlippageMode] = useState<SlippageMode>('500');
  const [customSlippage, setCustomSlippage] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── SOL balance ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!publicKey) { setSolBalance(null); return; }
    let cancelled = false;
    const fetch_ = async (attempt = 1) => {
      try {
        const bal = await connection.getBalance(publicKey);
        if (!cancelled) setSolBalance(bal / LAMPORTS_PER_SOL);
      } catch (err) {
        console.warn('[SwapWidget] getBalance error (attempt', attempt, '):', err);
        if (attempt < 2 && !cancelled) setTimeout(() => fetch_(2), 2000);
        else if (!cancelled) setSolBalance(null);
      }
    };
    fetch_();
    return () => { cancelled = true; };
  }, [publicKey, connection]);

  // ── Token balance (needed for sell direction) ─────────────────────────────
  useEffect(() => {
    if (!publicKey) { setTokenBalance(null); return; }
    let cancelled = false;
    const fetch_ = async () => {
      try {
        const ata = getAssociatedTokenAddressSync(new PublicKey(tokenMint), publicKey);
        const info = await connection.getTokenAccountBalance(ata);
        if (!cancelled) setTokenBalance(Number(info.value.amount) / Math.pow(10, LAUNCHPAD_TOKEN_DECIMALS));
      } catch {
        if (!cancelled) setTokenBalance(0);
      }
    };
    fetch_();
    return () => { cancelled = true; };
  }, [publicKey, tokenMint, connection]);

  // ── Quote fetching ─────────────────────────────────────────────────────────
  const fetchQuote = useCallback(async (rawInput: string, bps: number, dir: Direction) => {
    const parsed = parseFloat(rawInput);
    if (!rawInput || isNaN(parsed) || parsed <= 0) {
      setQuote(null);
      setSwapError(null);
      setSwapErrorDetail(null);
      return;
    }

    setIsQuoting(true);
    setSwapError(null);
    setSwapErrorDetail(null);
    setQuote(null);

    // For buy: input is SOL → convert to lamports
    // For sell: input is token → convert using LAUNCHPAD_TOKEN_DECIMALS
    const inputDecimals = dir === 'buy' ? 9 : LAUNCHPAD_TOKEN_DECIMALS;
    const rawAmount = Math.round(parsed * Math.pow(10, inputDecimals));

    console.log('[SwapWidget] fetchQuote:', { dir, rawAmount, slippageBps: bps, tokenMint });

    try {
      let result: NormalizedQuote;

      if (dir === 'buy') {
        // BUY: SOL → token. Try CPMM first, fall through to LaunchLab.
        try {
          result = await getRaydiumQuote(SOL_MINT, tokenMint, rawAmount);
          console.log('[SwapWidget] CPMM buy quote success');
        } catch (cpmmErr) {
          const msg = cpmmErr instanceof Error ? cpmmErr.message : String(cpmmErr);
          if (msg !== 'POOL_NOT_FOUND') throw cpmmErr;
          console.log('[SwapWidget] CPMM not found, trying LaunchLab buy…');
          result = await getLaunchpadQuote(tokenMint, rawAmount, bps, 'buy');
        }
      } else {
        // SELL: token → SOL. Try CPMM first (reversed mints), fall through.
        try {
          result = await getRaydiumQuote(tokenMint, SOL_MINT, rawAmount);
          console.log('[SwapWidget] CPMM sell quote success');
        } catch (cpmmErr) {
          const msg = cpmmErr instanceof Error ? cpmmErr.message : String(cpmmErr);
          if (msg !== 'POOL_NOT_FOUND') throw cpmmErr;
          console.log('[SwapWidget] CPMM not found, trying LaunchLab sell…');
          result = await getLaunchpadQuote(tokenMint, rawAmount, bps, 'sell');
        }
      }

      console.log('[SwapWidget] quote success:', result);
      setQuote(result);

    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      console.error('[SwapWidget] fetchQuote error:', raw);
      const msgL = raw.toLowerCase();
      if (
        msgL.includes('launchpad_pool_not_found') ||
        msgL.includes('pool_not_found') ||
        msgL.includes('no route') ||
        msgL.includes('could not find') ||
        msgL.includes('route not found')
      ) {
        setSwapError('NO_LIQUIDITY');
      } else {
        setSwapError('TX_FAILED');
        setSwapErrorDetail(raw);
      }
    } finally {
      setIsQuoting(false);
    }
  }, [tokenMint, connection]);

  const triggerFetch = (input: string, bps: number, dir: Direction, delay = 300) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuote(input, bps, dir), delay);
  };

  const handleInputChange = (val: string) => {
    if (val !== '' && !/^\d*\.?\d*$/.test(val)) return;
    setInputAmount(val);
    setTxSignature(null);
    triggerFetch(val, slippageBps, direction);
  };

  const handleDirectionToggle = (newDir: Direction) => {
    if (newDir === direction) return;
    setDirection(newDir);
    setInputAmount('');
    setQuote(null);
    setSwapError(null);
    setSwapErrorDetail(null);
    setTxSignature(null);
  };

  const handleSlippageChange = (mode: SlippageMode, bps: number) => {
    setSlippageMode(mode);
    setSlippageBps(bps);
    if (inputAmount && parseFloat(inputAmount) > 0) {
      triggerFetch(inputAmount, bps, direction, 150);
    }
  };

  const handleCustomSlippageChange = (val: string) => {
    if (val !== '' && !/^\d*\.?\d*$/.test(val)) return;
    setCustomSlippage(val);
    const pct = parseFloat(val);
    if (!isNaN(pct) && pct > 0 && pct <= 50) {
      handleSlippageChange('custom', Math.round(pct * 100));
    }
  };

  // ── Swap execution ─────────────────────────────────────────────────────────
  const handleSwap = async () => {
    if (!connected || !publicKey || !signTransaction) {
      setSwapError('WALLET_NOT_CONNECTED');
      return;
    }
    if (!quote) return;

    const parsed = parseFloat(inputAmount);
    if (direction === 'buy' && solBalance !== null && parsed > solBalance) {
      setSwapError('INSUFFICIENT_BALANCE');
      return;
    }
    if (direction === 'sell' && tokenBalance !== null && parsed > tokenBalance) {
      setSwapError('INSUFFICIENT_BALANCE');
      return;
    }

    setIsSwapping(true);
    setSwapError(null);
    setSwapErrorDetail(null);
    setTxSignature(null);
    setSwapSummary(null);

    const inputLabel = direction === 'buy'
      ? `${inputAmount} SOL`
      : `${inputAmount} ${tokenSymbol}`;
    const outputLabel = direction === 'buy'
      ? `${formatAmount(quote.outAmountRaw, quote.outDecimals ?? 9)} ${tokenSymbol}`
      : `${formatAmount(quote.outAmountRaw, 9)} SOL`;

    try {
      let sig: string;
      const walletSign = (tx: Transaction) =>
        signTransaction(tx as Transaction) as Promise<Transaction>;

      if (quote.subRouter === 'launchpad') {
        sig = await executeLaunchpadSwap(quote, publicKey, walletSign);
      } else {
        sig = await executeRaydiumSwap(quote, publicKey, walletSign);
      }

      console.log('[SwapWidget] swap confirmed:', sig);
      setTxSignature(sig);
      setSwapSummary({ input: inputLabel, output: outputLabel });
      onSwapComplete?.(sig);

      setInputAmount('');
      setQuote(null);

      // Refresh balances
      connection.getBalance(publicKey).then(b => setSolBalance(b / LAMPORTS_PER_SOL)).catch(() => {});
      try {
        const ata = getAssociatedTokenAddressSync(new PublicKey(tokenMint), publicKey);
        connection.getTokenAccountBalance(ata).then(b => setTokenBalance(Number(b.value.amount) / Math.pow(10, LAUNCHPAD_TOKEN_DECIMALS))).catch(() => {});
      } catch { /* no ata */ }

    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      console.error('[SwapWidget] handleSwap error:', raw);
      if (raw.toLowerCase().includes('insufficient') || raw.includes('0x1')) {
        setSwapError('INSUFFICIENT_BALANCE');
      } else {
        setSwapError('TX_FAILED');
        setSwapErrorDetail(raw);
      }
    } finally {
      setIsSwapping(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const priceImpact = quote ? formatPriceImpact(quote.priceImpactPct) : null;
  const canSwap = connected && quote && !isQuoting && !isSwapping && parseFloat(inputAmount) > 0;
  const routerLabel = quote
    ? quote.subRouter === 'launchpad' ? 'LAUNCHPAD' : 'RAYDIUM CPMM'
    : 'RAYDIUM';

  const isLaunchpad = quote?.subRouter === 'launchpad';
  const priceImpactFloat = quote ? parseFloat(quote.priceImpactPct) : 0;
  const slippagePct = slippageBps / 100;
  const warnHighImpact = !!quote && priceImpactFloat > slippagePct;
  const warnLowSlippage = isLaunchpad && slippageBps < 100;

  // Balance used for the current direction
  const inputBalance = direction === 'buy' ? solBalance : tokenBalance;
  const inputSymbol  = direction === 'buy' ? '◎ SOL' : `◈ ${tokenSymbol}`;
  const outputSymbol = direction === 'buy' ? `◈ ${tokenSymbol}` : '◎ SOL';
  const outputDecimals = direction === 'buy' ? (quote?.outDecimals ?? 9) : 9;

  const errorMessages: Record<NonNullable<SwapError>, string> = {
    POOL_NOT_FOUND: 'POOL NOT FOUND',
    NO_ROUTE: 'NO ROUTE FOUND',
    NO_LIQUIDITY: 'NO RAYDIUM POOL FOUND — TRADE ON LETSBONK.FUN',
    INSUFFICIENT_BALANCE: `INSUFFICIENT ${direction === 'buy' ? 'SOL' : tokenSymbol} BALANCE`,
    TX_FAILED: swapErrorDetail
      ? `TX FAILED: ${swapErrorDetail.slice(0, 80)}`
      : 'TRANSACTION FAILED — TRY AGAIN',
    WALLET_NOT_CONNECTED: 'CONNECT YOUR WALLET FIRST',
  };

  const slippageOptions: { label: string; mode: SlippageMode; bps: number }[] = [
    { label: '1%',  mode: '100',  bps: 100  },
    { label: '2%',  mode: '200',  bps: 200  },
    { label: '5%',  mode: '500',  bps: 500  },
    { label: '10%', mode: '1000', bps: 1000 },
    { label: 'CUSTOM', mode: 'custom', bps: slippageBps },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      {/* BUY / SELL toggle */}
      <div style={styles.directionToggle}>
        <button
          style={{
            ...styles.dirBtn,
            ...(direction === 'buy' ? styles.dirBtnBuy : styles.dirBtnInactive),
          }}
          onClick={() => handleDirectionToggle('buy')}
        >
          ▲ BUY
        </button>
        <button
          style={{
            ...styles.dirBtn,
            ...(direction === 'sell' ? styles.dirBtnSell : styles.dirBtnInactive),
          }}
          onClick={() => handleDirectionToggle('sell')}
        >
          ▼ SELL
        </button>
      </div>

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>◈ {direction === 'buy' ? 'BUY' : 'SELL'} {tokenSymbol}</span>
        <div style={styles.headerRight}>
          <span style={styles.routerBadge}>{routerLabel}</span>
          <span style={styles.feeTag}>FEE: {PLATFORM_FEE_PCT}%</span>
        </div>
      </div>

      {/* Input — YOU SELL */}
      <div style={styles.tokenBox}>
        <div style={styles.tokenLabel}>
          <span style={styles.tokenName}>
            <span style={styles.youLabel}>YOU SELL&nbsp;&nbsp;</span>
            {inputSymbol}
          </span>
          {inputBalance !== null && (
            <button
              style={styles.balanceBtn}
              onClick={() => handleInputChange(inputBalance.toFixed(direction === 'buy' ? 6 : 4))}
            >
              BAL: {inputBalance.toFixed(direction === 'buy' ? 4 : 2)}
            </button>
          )}
        </div>
        <input
          style={styles.input}
          type="text"
          inputMode="decimal"
          placeholder="0.0"
          value={inputAmount}
          onChange={(e) => handleInputChange(e.target.value)}
        />
      </div>

      {/* Arrow */}
      <div style={styles.arrowRow}>
        <div style={styles.arrowLine} />
        <span style={styles.arrow}>▼</span>
        <div style={styles.arrowLine} />
      </div>

      {/* Output — YOU RECEIVE */}
      <div style={styles.tokenBox}>
        <div style={styles.tokenLabel}>
          <span style={styles.tokenName}>
            <span style={styles.youLabel}>YOU RECEIVE&nbsp;&nbsp;</span>
            {outputSymbol}
          </span>
          {direction === 'buy' && <span style={styles.lockedTag}>LOCKED</span>}
        </div>
        <div style={styles.outputAmount}>
          {isQuoting ? (
            <span style={styles.quoting}>ROUTING...</span>
          ) : swapError === 'POOL_NOT_FOUND' || swapError === 'NO_LIQUIDITY' ? (
            <span style={styles.noLiquidity}>POOL COMING SOON</span>
          ) : quote ? (
            <span style={styles.outputValue}>{formatAmount(quote.outAmountRaw, outputDecimals)}</span>
          ) : (
            <span style={styles.placeholder}>—</span>
          )}
        </div>
      </div>

      {/* Bonding curve progress bar — buy only */}
      {direction === 'buy' && quote?.bondingProgress && !isQuoting && (
        <div style={styles.progressBox}>
          <div style={styles.progressHeader}>
            <span style={styles.progressLabel}>◈ BONDING CURVE</span>
            <span style={styles.progressPct}>{quote.bondingProgress.pct.toFixed(1)}%</span>
          </div>
          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressFill,
                width: `${Math.min(quote.bondingProgress.pct, 100)}%`,
                background: quote.bondingProgress.pct >= 100
                  ? 'linear-gradient(90deg, #7c3aed, #ec4899)'
                  : `linear-gradient(90deg, #7c3aed ${100 - quote.bondingProgress.pct}%, #a855f7 100%)`,
              }}
            />
          </div>
          <div style={styles.progressStat}>
            <span>{quote.bondingProgress.raisedSol.toFixed(2)} SOL raised</span>
            <span>{quote.bondingProgress.targetSol.toFixed(0)} SOL target</span>
          </div>
        </div>
      )}

      {/* Quote details */}
      {quote && !isQuoting && (
        <div style={styles.details}>
          <div style={styles.detailRow}>
            <span style={styles.detailKey}>PRICE IMPACT</span>
            <span style={{ ...styles.detailValue, color: priceImpact!.color }}>
              {priceImpact!.label}
            </span>
          </div>
          {quote.route && (
            <div style={styles.detailRow}>
              <span style={styles.detailKey}>ROUTE</span>
              <span style={{ ...styles.detailValue, color: '#c084fc' }}>{quote.route}</span>
            </div>
          )}
          <div style={styles.detailRow}>
            <span style={styles.detailKey}>MIN RECEIVED</span>
            <span style={styles.detailValue}>
              {formatAmount(quote.minOutAmountRaw, outputDecimals)}
              {' '}{direction === 'buy' ? tokenSymbol : 'SOL'}
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {swapError && (
        <div style={styles.errorBox}>
          <span style={styles.errorText}>✗ {errorMessages[swapError]}</span>
          {swapError === 'NO_LIQUIDITY' && (
            <a
              href={`https://letsbonk.fun/token/${tokenMint}`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.letsbonkLink}
            >
              TRADE ON LETSBONK.FUN ↗
            </a>
          )}
        </div>
      )}

      {/* Success */}
      {txSignature && (
        <div style={styles.successBox}>
          <div style={styles.successInner}>
            <span style={styles.successText}>✓ SWAP CONFIRMED</span>
            {swapSummary && (
              <span style={styles.successSummary}>
                {swapSummary.input} → {swapSummary.output}
              </span>
            )}
          </div>
          <a
            href={`https://solscan.io/tx/${txSignature}`}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.txLink}
          >
            VIEW TX ↗
          </a>
        </div>
      )}

      {/* Slippage selector */}
      <div style={styles.slippageSection}>
        <span style={styles.slippageLabel}>SLIPPAGE TOLERANCE</span>
        <div style={styles.slippagePills}>
          {slippageOptions.map(({ label, mode, bps }) => {
            const isSelected = slippageMode === mode;
            return (
              <button
                key={mode}
                style={{
                  ...styles.slippagePill,
                  ...(isSelected ? styles.slippagePillActive : styles.slippagePillInactive),
                }}
                onClick={() => {
                  if (mode === 'custom') { setSlippageMode('custom'); }
                  else { handleSlippageChange(mode, bps); }
                }}
              >
                {mode === 'custom' && slippageMode === 'custom' && customSlippage
                  ? `${customSlippage}%` : label}
              </button>
            );
          })}
        </div>
        {slippageMode === 'custom' && (
          <div style={styles.customInputRow}>
            <input
              style={styles.customInput}
              type="text"
              inputMode="decimal"
              placeholder="e.g. 3.5"
              value={customSlippage}
              onChange={(e) => handleCustomSlippageChange(e.target.value)}
              autoFocus
            />
            <span style={styles.customInputSuffix}>%</span>
          </div>
        )}
      </div>

      {/* Warnings */}
      {warnLowSlippage && (
        <div style={styles.warnBox}>
          <span style={styles.warnText}>⚠ SLIPPAGE TOO LOW FOR BONDING CURVE</span>
          <span style={styles.warnSub}>RECOMMEND MINIMUM 1% ON LAUNCHPAD POOLS</span>
        </div>
      )}
      {warnHighImpact && !warnLowSlippage && (
        <div style={styles.warnBox}>
          <span style={styles.warnText}>⚠ SWAP MAY FAIL — INCREASE SLIPPAGE</span>
          <span style={styles.warnSub}>
            PRICE IMPACT ({priceImpactFloat.toFixed(2)}%) EXCEEDS TOLERANCE ({slippagePct.toFixed(1)}%)
          </span>
        </div>
      )}

      {/* Swap button */}
      <button
        style={{
          ...styles.swapBtn,
          ...(!connected
            ? styles.swapBtnConnect
            : canSwap
              ? (direction === 'sell' ? styles.swapBtnSell : styles.swapBtnActive)
              : styles.swapBtnDisabled),
          ...(isSwapping ? styles.swapBtnSwapping : {}),
        }}
        onClick={!connected ? () => openWalletModal(true) : handleSwap}
        disabled={connected && !canSwap}
      >
        {isSwapping
          ? (direction === 'sell' ? 'SELLING...' : 'SWAPPING...')
          : !connected
            ? 'CONNECT WALLET'
            : direction === 'sell'
              ? 'EXECUTE SELL'
              : 'EXECUTE SWAP'}
      </button>

      {/* Footer */}
      <div style={styles.footer}>
        SLIPPAGE: {slippagePct.toFixed(1)}%
        &nbsp;·&nbsp;POWERED BY RAYDIUM
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const fontStack = '"Press Start 2P", "Courier New", monospace';

const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: fontStack,
    fontSize: '10px',
    background: 'linear-gradient(160deg, #0d0015 0%, #100020 60%, #0a001a 100%)',
    border: '1px solid #7c3aed',
    borderRadius: '12px',
    padding: '20px',
    width: '100%',
    maxWidth: '420px',
    boxShadow: '0 0 30px rgba(168, 85, 247, 0.25), inset 0 0 60px rgba(88, 28, 135, 0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    boxSizing: 'border-box',
  },
  // ── Direction toggle ───────────────────────────────────────────────────────
  directionToggle: {
    display: 'flex',
    gap: '6px',
    background: 'rgba(15, 0, 30, 0.6)',
    border: '1px solid #3b0764',
    borderRadius: '8px',
    padding: '4px',
  },
  dirBtn: {
    flex: 1,
    fontFamily: fontStack,
    fontSize: '8px',
    letterSpacing: '2px',
    padding: '8px 0',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  dirBtnBuy: {
    background: 'linear-gradient(135deg, #059669, #10b981)',
    color: '#fff',
    boxShadow: '0 0 12px rgba(16, 185, 129, 0.45)',
  },
  dirBtnSell: {
    background: 'linear-gradient(135deg, #db2777, #9d174d)',
    color: '#fff',
    boxShadow: '0 0 12px rgba(219, 39, 119, 0.45)',
  },
  dirBtnInactive: {
    background: 'transparent',
    color: '#4c1d95',
  },
  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '8px',
    borderBottom: '1px solid #3b0764',
  },
  headerTitle: {
    color: '#e879f9',
    fontSize: '12px',
    letterSpacing: '2px',
    textShadow: '0 0 10px rgba(232, 121, 249, 0.6)',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  routerBadge: {
    color: '#6d28d9',
    fontSize: '6px',
    letterSpacing: '1px',
    background: 'rgba(88, 28, 135, 0.2)',
    border: '1px solid #3b0764',
    borderRadius: '4px',
    padding: '2px 5px',
  },
  feeTag: {
    color: '#a855f7',
    background: 'rgba(88, 28, 135, 0.4)',
    border: '1px solid #7c3aed',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '8px',
    letterSpacing: '1px',
  },
  // ── Token boxes ────────────────────────────────────────────────────────────
  tokenBox: {
    background: 'rgba(88, 28, 135, 0.12)',
    border: '1px solid #4c1d95',
    borderRadius: '8px',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  tokenLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '6px',
  },
  youLabel: {
    color: '#4c1d95',
    fontSize: '6px',
    letterSpacing: '1px',
  },
  tokenName: {
    color: '#c084fc',
    fontSize: '10px',
    letterSpacing: '1px',
    display: 'flex',
    alignItems: 'center',
  },
  balanceBtn: {
    background: 'transparent',
    border: '1px solid #6d28d9',
    borderRadius: '4px',
    color: '#a855f7',
    fontFamily: fontStack,
    fontSize: '8px',
    padding: '2px 6px',
    cursor: 'pointer',
    letterSpacing: '1px',
    flexShrink: 0,
  },
  lockedTag: {
    color: '#6d28d9',
    fontSize: '8px',
    letterSpacing: '1px',
    flexShrink: 0,
  },
  input: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#f0abfc',
    fontFamily: fontStack,
    fontSize: '18px',
    width: '100%',
    caretColor: '#e879f9',
  },
  outputAmount: {
    fontSize: '18px',
    minHeight: '27px',
    display: 'flex',
    alignItems: 'center',
  },
  outputValue: { color: '#f0abfc' },
  quoting: {
    color: '#7c3aed',
    fontSize: '10px',
    animation: 'pulse 1s infinite',
    letterSpacing: '2px',
  },
  placeholder: { color: '#4c1d95' },
  noLiquidity: { color: '#db2777', fontSize: '10px', letterSpacing: '1px' },
  // ── Arrow ──────────────────────────────────────────────────────────────────
  arrowRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  arrowLine: {
    flex: 1,
    height: '1px',
    background: 'linear-gradient(90deg, transparent, #3b0764)',
  },
  arrow: {
    color: '#7c3aed',
    fontSize: '12px',
    textShadow: '0 0 8px rgba(124, 58, 237, 0.8)',
  },
  // ── Details ────────────────────────────────────────────────────────────────
  details: {
    background: 'rgba(15, 0, 30, 0.6)',
    border: '1px solid #3b0764',
    borderRadius: '6px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  detailKey: {
    color: '#6d28d9',
    letterSpacing: '1px',
    fontSize: '8px',
    flexShrink: 0,
  },
  detailValue: {
    color: '#a855f7',
    fontSize: '8px',
    letterSpacing: '1px',
    textAlign: 'right',
    wordBreak: 'break-all',
  },
  // ── Error / success ────────────────────────────────────────────────────────
  errorBox: {
    background: 'rgba(190, 18, 60, 0.12)',
    border: '1px solid #9f1239',
    borderRadius: '6px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  errorText: { color: '#fb7185', fontSize: '9px', letterSpacing: '1px' },
  letsbonkLink: {
    color: '#e879f9',
    fontSize: '8px',
    letterSpacing: '1px',
    textDecoration: 'none',
    borderBottom: '1px solid #7c3aed',
    alignSelf: 'flex-start' as const,
    paddingBottom: '1px',
  },
  successBox: {
    background: 'rgba(88, 28, 135, 0.2)',
    border: '1px solid #7c3aed',
    borderRadius: '6px',
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  successInner: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '5px',
    minWidth: 0,
  },
  successText: {
    color: '#e879f9',
    fontSize: '9px',
    letterSpacing: '1px',
    textShadow: '0 0 8px rgba(232, 121, 249, 0.5)',
  },
  successSummary: {
    color: '#a855f7',
    fontSize: '7px',
    letterSpacing: '1px',
    wordBreak: 'break-all' as const,
  },
  txLink: {
    color: '#a855f7',
    fontSize: '8px',
    textDecoration: 'none',
    letterSpacing: '1px',
    borderBottom: '1px solid #7c3aed',
  },
  // ── Slippage selector ──────────────────────────────────────────────────────
  slippageSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  slippageLabel: { color: '#6d28d9', fontSize: '6px', letterSpacing: '1.5px' },
  slippagePills: { display: 'flex', gap: '6px', flexWrap: 'wrap' as const },
  slippagePill: {
    fontFamily: fontStack,
    fontSize: '6px',
    letterSpacing: '1px',
    padding: '5px 8px',
    borderRadius: '20px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    whiteSpace: 'nowrap' as const,
  },
  slippagePillActive: {
    background: 'linear-gradient(135deg, #db2777, #9d174d)',
    color: '#fff',
    boxShadow: '0 0 10px rgba(219, 39, 119, 0.45)',
  },
  slippagePillInactive: {
    background: 'rgba(88, 28, 135, 0.15)',
    color: '#a855f7',
    border: '1px solid #3b0764',
  },
  customInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(88, 28, 135, 0.12)',
    border: '1px solid #6d28d9',
    borderRadius: '6px',
    padding: '6px 10px',
    marginTop: '2px',
  },
  customInput: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#f0abfc',
    fontFamily: fontStack,
    fontSize: '10px',
    width: '60px',
    caretColor: '#e879f9',
  },
  customInputSuffix: { color: '#7c3aed', fontSize: '8px', letterSpacing: '1px' },
  // ── Warnings ───────────────────────────────────────────────────────────────
  warnBox: {
    background: 'rgba(190, 18, 60, 0.1)',
    border: '1px solid #be185d',
    borderRadius: '6px',
    padding: '9px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '5px',
  },
  warnText: { color: '#f472b6', fontSize: '7px', letterSpacing: '1px' },
  warnSub: { color: '#9f1239', fontSize: '6px', letterSpacing: '0.5px' },
  // ── Swap button ────────────────────────────────────────────────────────────
  swapBtn: {
    fontFamily: fontStack,
    fontSize: '11px',
    letterSpacing: '2px',
    padding: '14px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
    transition: 'all 0.15s ease',
  },
  swapBtnConnect: {
    background: 'linear-gradient(135deg, #db2777, #9d174d)',
    color: '#fff',
    boxShadow: '0 0 20px rgba(219, 39, 119, 0.4)',
    cursor: 'pointer',
  },
  swapBtnActive: {
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    color: '#fff',
    boxShadow: '0 0 20px rgba(168, 85, 247, 0.4)',
    cursor: 'pointer',
  },
  swapBtnSell: {
    background: 'linear-gradient(135deg, #db2777, #9d174d)',
    color: '#fff',
    boxShadow: '0 0 20px rgba(219, 39, 119, 0.45)',
    cursor: 'pointer',
  },
  swapBtnDisabled: {
    background: 'rgba(88, 28, 135, 0.2)',
    color: '#4c1d95',
    cursor: 'not-allowed',
    border: '1px solid #3b0764',
  },
  swapBtnSwapping: {
    background: 'linear-gradient(135deg, #5b21b6, #9d174d)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'not-allowed',
  },
  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    color: '#4c1d95',
    fontSize: '7px',
    letterSpacing: '1px',
    textAlign: 'center',
  },
  // ── Progress bar ───────────────────────────────────────────────────────────
  progressBox: {
    background: 'rgba(88, 28, 135, 0.12)',
    border: '1px solid #4c1d95',
    borderRadius: '8px',
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: { color: '#c084fc', fontSize: '8px', letterSpacing: '1px' },
  progressPct: {
    color: '#e879f9',
    fontSize: '8px',
    letterSpacing: '1px',
    textShadow: '0 0 6px rgba(232, 121, 249, 0.5)',
  },
  progressTrack: {
    height: '6px',
    background: 'rgba(88, 28, 135, 0.3)',
    borderRadius: '3px',
    overflow: 'hidden',
    border: '1px solid #3b0764',
  },
  progressFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
    boxShadow: '0 0 6px rgba(168, 85, 247, 0.5)',
  },
  progressStat: {
    display: 'flex',
    justifyContent: 'space-between',
    color: '#6d28d9',
    fontSize: '7px',
    letterSpacing: '1px',
  },
};
