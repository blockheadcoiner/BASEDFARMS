'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  getQuote,
  getSwapTransaction,
  PLATFORM_FEE_BPS,
  type QuoteResponse,
} from '@/services/jupiter';

// SOL mint address
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PLATFORM_FEE_PCT = (PLATFORM_FEE_BPS / 100).toFixed(1);

type SwapError = 'NO_ROUTE' | 'INSUFFICIENT_BALANCE' | 'TX_FAILED' | 'WALLET_NOT_CONNECTED' | null;

interface Props {
  tokenMint: string;
  tokenSymbol?: string;
  feeAccount?: string;
  onSwapComplete?: (txSignature: string) => void;
}

function formatAmount(lamports: string, decimals = 9): string {
  const n = Number(lamports) / Math.pow(10, decimals);
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

export default function SwapWidget({ tokenMint, tokenSymbol = 'TOKEN', feeAccount, onSwapComplete }: Props) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [inputAmount, setInputAmount] = useState('');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [swapError, setSwapError] = useState<SwapError>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch SOL balance when wallet connects
  useEffect(() => {
    if (!publicKey) { setSolBalance(null); return; }
    connection.getBalance(publicKey).then((bal) => setSolBalance(bal / LAMPORTS_PER_SOL));
  }, [publicKey, connection]);

  const fetchQuote = useCallback(async (rawInput: string) => {
    const parsed = parseFloat(rawInput);
    if (!rawInput || isNaN(parsed) || parsed <= 0) {
      setQuote(null);
      setSwapError(null);
      return;
    }

    setIsQuoting(true);
    setSwapError(null);
    setQuote(null);

    try {
      const lamports = Math.round(parsed * LAMPORTS_PER_SOL);
      const result = await getQuote(SOL_MINT, tokenMint, lamports);
      setQuote(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('no route') || msg.includes('could not find')) {
        setSwapError('NO_ROUTE');
      } else {
        setSwapError('TX_FAILED');
      }
    } finally {
      setIsQuoting(false);
    }
  }, [tokenMint]);

  const handleInputChange = (val: string) => {
    // Only allow valid numeric input
    if (val !== '' && !/^\d*\.?\d*$/.test(val)) return;
    setInputAmount(val);
    setTxSignature(null);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchQuote(val), 300);
  };

  const handleSwap = async () => {
    if (!connected || !publicKey || !signTransaction) {
      setSwapError('WALLET_NOT_CONNECTED');
      return;
    }
    if (!quote) return;

    const parsed = parseFloat(inputAmount);
    if (solBalance !== null && parsed > solBalance) {
      setSwapError('INSUFFICIENT_BALANCE');
      return;
    }

    setIsSwapping(true);
    setSwapError(null);
    setTxSignature(null);

    try {
      const swapTx = await getSwapTransaction(quote, publicKey.toBase58(), feeAccount);
      const txBuffer = Buffer.from(swapTx, 'base64');
      const transaction = VersionedTransaction.deserialize(txBuffer);

      const signed = await signTransaction(transaction);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
      setTxSignature(sig);
      onSwapComplete?.(sig);

      // Reset
      setInputAmount('');
      setQuote(null);
      connection.getBalance(publicKey).then((bal) => setSolBalance(bal / LAMPORTS_PER_SOL));
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('insufficient') || msg.includes('0x1')) {
        setSwapError('INSUFFICIENT_BALANCE');
      } else {
        setSwapError('TX_FAILED');
      }
    } finally {
      setIsSwapping(false);
    }
  };

  const priceImpact = quote ? formatPriceImpact(quote.priceImpactPct) : null;
  const routeLabels = quote?.routePlan.map((r) => r.swapInfo.label).join(' → ');
  const platformFeeAmount = quote?.platformFee
    ? formatAmount(quote.platformFee.amount)
    : null;

  const canSwap = connected && quote && !isQuoting && !isSwapping && parseFloat(inputAmount) > 0;

  const errorMessages: Record<NonNullable<SwapError>, string> = {
    NO_ROUTE: 'NO ROUTE FOUND FOR THIS PAIR',
    INSUFFICIENT_BALANCE: 'INSUFFICIENT SOL BALANCE',
    TX_FAILED: 'TRANSACTION FAILED — TRY AGAIN',
    WALLET_NOT_CONNECTED: 'CONNECT YOUR WALLET FIRST',
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>◈ SWAP</span>
        <span style={styles.feeTag}>FEE: {PLATFORM_FEE_PCT}%</span>
      </div>

      {/* Input token — SOL */}
      <div style={styles.tokenBox}>
        <div style={styles.tokenLabel}>
          <span style={styles.tokenName}>◎ SOL</span>
          {solBalance !== null && (
            <button
              style={styles.balanceBtn}
              onClick={() => handleInputChange(solBalance.toFixed(6))}
            >
              BAL: {solBalance.toFixed(4)}
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

      {/* Output token */}
      <div style={styles.tokenBox}>
        <div style={styles.tokenLabel}>
          <span style={styles.tokenName}>◈ {tokenSymbol}</span>
          <span style={styles.lockedTag}>LOCKED</span>
        </div>
        <div style={styles.outputAmount}>
          {isQuoting ? (
            <span style={styles.quoting}>ROUTING...</span>
          ) : quote ? (
            <span style={styles.outputValue}>{formatAmount(quote.outAmount)}</span>
          ) : (
            <span style={styles.placeholder}>—</span>
          )}
        </div>
      </div>

      {/* Quote details */}
      {quote && !isQuoting && (
        <div style={styles.details}>
          <div style={styles.detailRow}>
            <span style={styles.detailKey}>PRICE IMPACT</span>
            <span style={{ ...styles.detailValue, color: priceImpact!.color }}>
              {priceImpact!.label}
            </span>
          </div>
          {routeLabels && (
            <div style={styles.detailRow}>
              <span style={styles.detailKey}>ROUTE</span>
              <span style={{ ...styles.detailValue, color: '#c084fc' }}>{routeLabels}</span>
            </div>
          )}
          {platformFeeAmount && (
            <div style={styles.detailRow}>
              <span style={styles.detailKey}>PLATFORM FEE</span>
              <span style={styles.detailValue}>{platformFeeAmount} SOL</span>
            </div>
          )}
          <div style={styles.detailRow}>
            <span style={styles.detailKey}>MIN RECEIVED</span>
            <span style={styles.detailValue}>{formatAmount(quote.otherAmountThreshold)}</span>
          </div>
        </div>
      )}

      {/* Error */}
      {swapError && (
        <div style={styles.errorBox}>
          <span style={styles.errorText}>✗ {errorMessages[swapError]}</span>
        </div>
      )}

      {/* Success */}
      {txSignature && (
        <div style={styles.successBox}>
          <span style={styles.successText}>✓ SWAP CONFIRMED</span>
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

      {/* Swap button */}
      <button
        style={{
          ...styles.swapBtn,
          ...(canSwap ? styles.swapBtnActive : styles.swapBtnDisabled),
          ...(isSwapping ? styles.swapBtnSwapping : {}),
        }}
        onClick={handleSwap}
        disabled={!canSwap}
      >
        {isSwapping ? 'SWAPPING...' : !connected ? 'CONNECT WALLET' : 'EXECUTE SWAP'}
      </button>

      {/* Slippage note */}
      <div style={styles.footer}>
        <span>SLIPPAGE: {quote ? `${quote.slippageBps / 100}%` : '0.5%'} · POWERED BY JUPITER</span>
      </div>
    </div>
  );
}

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
  feeTag: {
    color: '#a855f7',
    background: 'rgba(88, 28, 135, 0.4)',
    border: '1px solid #7c3aed',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '8px',
    letterSpacing: '1px',
  },
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
  },
  tokenName: {
    color: '#c084fc',
    fontSize: '10px',
    letterSpacing: '1px',
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
  },
  lockedTag: {
    color: '#6d28d9',
    fontSize: '8px',
    letterSpacing: '1px',
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
  outputValue: {
    color: '#f0abfc',
  },
  quoting: {
    color: '#7c3aed',
    fontSize: '10px',
    animation: 'pulse 1s infinite',
    letterSpacing: '2px',
  },
  placeholder: {
    color: '#4c1d95',
  },
  arrowRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
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
  errorBox: {
    background: 'rgba(190, 18, 60, 0.12)',
    border: '1px solid #9f1239',
    borderRadius: '6px',
    padding: '10px 12px',
  },
  errorText: {
    color: '#fb7185',
    fontSize: '9px',
    letterSpacing: '1px',
  },
  successBox: {
    background: 'rgba(88, 28, 135, 0.2)',
    border: '1px solid #7c3aed',
    borderRadius: '6px',
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  successText: {
    color: '#e879f9',
    fontSize: '9px',
    letterSpacing: '1px',
    textShadow: '0 0 8px rgba(232, 121, 249, 0.5)',
  },
  txLink: {
    color: '#a855f7',
    fontSize: '8px',
    textDecoration: 'none',
    letterSpacing: '1px',
    borderBottom: '1px solid #7c3aed',
  },
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
  swapBtnActive: {
    background: 'linear-gradient(135deg, #7c3aed, #db2777)',
    color: '#fff',
    boxShadow: '0 0 20px rgba(168, 85, 247, 0.4)',
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
  footer: {
    color: '#4c1d95',
    fontSize: '7px',
    letterSpacing: '1px',
    textAlign: 'center',
  },
};
