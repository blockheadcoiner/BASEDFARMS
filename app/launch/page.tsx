'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';
import {
  createToken,
  uploadMetadata,
  calcBasedScore,
  CpmmCreatorFeeOn,
  LAUNCH_FEE_LAMPORTS,
  type LaunchParams,
} from '@/services/launch';
import { useWalletModal } from '@/components/WalletProvider';

const font = 'var(--font-press-start), "Courier New", monospace';

/* ── Form state ───────────────────────────────────────────────────────────── */

interface FormState {
  // Step 1
  tokenName: string;
  tokenSymbol: string;
  description: string;
  imageDataUri: string;
  decimals: 6 | 9;
  // Step 2
  supply: number;
  curvePercent: number;
  targetSol: number;
  // Step 3
  token2022: boolean;
  transferFeeBps: number;
  maxTransferFeeTokens: number;
  vestingEnabled: boolean;
  vestingPercent: number;
  cliffDays: number;
  unlockDays: number;
  initialBuyEnabled: boolean;
  initialBuySol: number;
  creatorFeeOn: CpmmCreatorFeeOn;
}

const DEFAULT: FormState = {
  tokenName: '',
  tokenSymbol: '',
  description: '',
  imageDataUri: '',
  decimals: 6,
  supply: 1_000_000_000,
  curvePercent: 79.31,
  targetSol: 85,
  token2022: false,
  transferFeeBps: 0,
  maxTransferFeeTokens: 0,
  vestingEnabled: false,
  vestingPercent: 10,
  cliffDays: 30,
  unlockDays: 365,
  initialBuyEnabled: false,
  initialBuySol: 0,
  creatorFeeOn: CpmmCreatorFeeOn.OnlyTokenB,
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmtNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K';
  return n.toLocaleString();
}

/* ── Sub-components ───────────────────────────────────────────────────────── */

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ ...styles.card, ...style }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={styles.label}>{children}</div>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={styles.hint}>{children}</div>;
}

function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <input
      style={{ ...styles.input, ...(disabled ? styles.inputDisabled : {}) }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      style={{ ...styles.input, ...(disabled ? styles.inputDisabled : {}) }}
      value={value}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      min={min}
      max={max}
      step={step ?? 1}
      disabled={disabled}
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div
      style={styles.toggleRow}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onChange(!checked); }}
    >
      <div style={{ ...styles.toggleTrack, background: checked ? '#db2777' : '#1e0035' }}>
        <div style={{ ...styles.toggleThumb, transform: checked ? 'translateX(20px)' : 'translateX(0)' }} />
      </div>
      <span style={styles.toggleLabel}>{label}</span>
    </div>
  );
}

/* ── Based Score Widget ───────────────────────────────────────────────────── */

function BasedScorePanel({ form }: { form: FormState }) {
  const scoreParams: Partial<LaunchParams> & { imageDataUri?: string } = {
    vestingEnabled: form.vestingEnabled,
    supply: form.supply,
    curvePercent: form.curvePercent,
    targetSol: form.targetSol,
    creatorFeeOn: form.creatorFeeOn,
    initialBuyLamports: form.initialBuyEnabled ? Math.round(form.initialBuySol * LAMPORTS_PER_SOL) : 0,
    imageDataUri: form.imageDataUri,
    description: form.description,
    symbol: form.tokenSymbol,
  };

  const { total, items } = calcBasedScore(scoreParams);

  const scoreColor =
    total >= 80 ? '#22c55e' :
    total >= 60 ? '#eab308' :
    total >= 40 ? '#f97316' :
    '#ef4444';

  return (
    <div style={styles.scorePanel}>
      <div style={styles.scorePanelTitle}>◈ BASED SCORE</div>

      {/* Arc-style score display */}
      <div style={styles.scoreCircle}>
        <span style={{ ...styles.scoreNumber, color: scoreColor }}>{total}</span>
        <span style={styles.scoreMax}>/100</span>
      </div>

      {/* Bar */}
      <div style={styles.scoreBarTrack}>
        <div
          style={{
            ...styles.scoreBarFill,
            width: `${total}%`,
            background: scoreColor,
            boxShadow: `0 0 8px ${scoreColor}`,
          }}
        />
      </div>

      <div style={styles.scoreLabel}>
        {total >= 80 ? '🔥 EXTREMELY BASED' :
         total >= 60 ? '✦ BASED' :
         total >= 40 ? '◎ FAIR' :
         '⚠ DEGEN'}
      </div>

      {/* Breakdown */}
      <div style={styles.scoreItems}>
        {items.map((item) => (
          <div key={item.label} style={styles.scoreItem}>
            <span style={{ color: item.earned ? '#22c55e' : '#3b0764', fontSize: '9px' }}>
              {item.earned ? '✓' : '○'}
            </span>
            <span style={{
              ...styles.scoreItemLabel,
              color: item.earned ? '#c084fc' : '#4c1d95',
            }}>
              {item.label}
            </span>
            <span style={{ ...styles.scoreItemPts, color: item.earned ? scoreColor : '#3b0764' }}>
              +{item.pts}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Step components ──────────────────────────────────────────────────────── */

function Step1({ form, setForm }: { form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>> }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImage = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be under 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      setForm((f) => ({ ...f, imageDataUri: (evt.target?.result as string) ?? '' }));
    };
    reader.readAsDataURL(file);
  }, [setForm]);

  return (
    <Card>
      <div style={styles.stepTitle}>STEP 1 · TOKEN BASICS</div>

      <div style={styles.field}>
        <Label>TOKEN NAME <span style={styles.required}>*</span></Label>
        <TextInput
          value={form.tokenName}
          onChange={(v) => setForm((f) => ({ ...f, tokenName: v }))}
          placeholder="e.g. Based Goose Money"
          maxLength={32}
        />
        <Hint>{form.tokenName.length}/32 characters</Hint>
      </div>

      <div style={styles.field}>
        <Label>TOKEN SYMBOL <span style={styles.required}>*</span></Label>
        <TextInput
          value={form.tokenSymbol}
          onChange={(v) => setForm((f) => ({ ...f, tokenSymbol: v.toUpperCase() }))}
          placeholder="e.g. BGM"
          maxLength={10}
        />
        <Hint>{form.tokenSymbol.length}/10 characters</Hint>
      </div>

      <div style={styles.field}>
        <Label>DESCRIPTION</Label>
        <textarea
          style={styles.textarea}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Tell the world about your token..."
          rows={3}
        />
      </div>

      <div style={styles.field}>
        <Label>TOKEN IMAGE</Label>
        <div
          style={{
            ...styles.imageUpload,
            borderColor: form.imageDataUri ? '#db2777' : '#3b0764',
          }}
          onClick={() => fileRef.current?.click()}
        >
          {form.imageDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.imageDataUri} alt="preview" style={styles.imagePreview} />
          ) : (
            <div style={styles.imageUploadInner}>
              <span style={styles.imageUploadIcon}>◎</span>
              <span style={styles.imageUploadText}>CLICK TO UPLOAD</span>
              <span style={styles.imageUploadHint}>PNG, JPG, GIF · MAX 2MB</span>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImage}
        />
        {form.imageDataUri && (
          <button
            style={styles.clearBtn}
            onClick={() => setForm((f) => ({ ...f, imageDataUri: '' }))}
          >
            ✕ REMOVE IMAGE
          </button>
        )}
      </div>

      <div style={styles.field}>
        <Label>DECIMALS</Label>
        <div style={styles.radioGroup}>
          {([6, 9] as (6 | 9)[]).map((d) => (
            <button
              key={d}
              style={{
                ...styles.radioBtn,
                ...(form.decimals === d ? styles.radioBtnActive : {}),
              }}
              onClick={() => setForm((f) => ({ ...f, decimals: d }))}
            >
              {d}
            </button>
          ))}
        </div>
        <Hint>6 = most common (like USDC) · 9 = like SOL</Hint>
      </div>
    </Card>
  );
}

function Step2({ form, setForm }: { form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>> }) {
  const sellA = Math.round(form.supply * form.curvePercent / 100);
  const reserved = form.supply - sellA;

  return (
    <Card>
      <div style={styles.stepTitle}>STEP 2 · SUPPLY &amp; CURVE</div>

      <div style={styles.field}>
        <Label>TOTAL SUPPLY</Label>
        <NumberInput
          value={form.supply}
          onChange={(v) => setForm((f) => ({ ...f, supply: Math.max(1, Math.round(v)) }))}
          min={1}
          step={1_000_000}
        />
        <Hint>{fmtNumber(form.supply)} tokens total</Hint>
      </div>

      <div style={styles.field}>
        <Label>% SOLD ON BONDING CURVE</Label>
        <div style={styles.sliderRow}>
          <input
            type="range"
            style={styles.slider}
            min={20}
            max={100}
            step={0.01}
            value={form.curvePercent}
            onChange={(e) => setForm((f) => ({ ...f, curvePercent: parseFloat(e.target.value) }))}
          />
          <span style={styles.sliderValue}>{form.curvePercent.toFixed(2)}%</span>
        </div>
        <div style={styles.curveStats}>
          <div style={styles.curveStat}>
            <span style={styles.curveStatLabel}>ON CURVE</span>
            <span style={styles.curveStatValue}>{fmtNumber(sellA)}</span>
          </div>
          <div style={styles.curveStat}>
            <span style={styles.curveStatLabel}>RESERVED</span>
            <span style={styles.curveStatValue}>{fmtNumber(reserved)}</span>
          </div>
        </div>
        <Hint>Higher % = fairer distribution. Raydium default is 79.31%</Hint>
      </div>

      <div style={styles.field}>
        <Label>SOL FUNDRAISING TARGET</Label>
        <NumberInput
          value={form.targetSol}
          onChange={(v) => setForm((f) => ({ ...f, targetSol: Math.max(1, v) }))}
          min={1}
          step={5}
        />
        <Hint>SOL raised before graduating to CPMM pool. Raydium default is 85 SOL</Hint>
      </div>

      <div style={styles.curveTypeBox}>
        <span style={styles.curveTypeLabel}>CURVE TYPE</span>
        <span style={styles.curveTypeBadge}>CONSTANT PRODUCT</span>
      </div>
    </Card>
  );
}

function Step3({ form, setForm }: { form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>> }) {
  // Estimate tokens received for initial buy using a rough constant-product formula
  const estimatedTokens = (() => {
    if (!form.initialBuyEnabled || form.initialBuySol <= 0) return 0;
    const sellA = form.supply * form.curvePercent / 100;
    // virtualB ≈ sellA * targetSol / (supply - sellA) — simplified estimate
    const virtualB = (sellA * form.targetSol) / (form.supply - sellA || 1);
    const inputSol = form.initialBuySol;
    const tokensOut = (sellA * inputSol) / (virtualB + inputSol);
    return Math.round(tokensOut);
  })();

  return (
    <Card>
      <div style={styles.stepTitle}>STEP 3 · ADVANCED OPTIONS</div>

      {/* Token-2022 */}
      <div style={styles.toggleSection}>
        <Toggle
          checked={form.token2022}
          onChange={(v) => setForm((f) => ({ ...f, token2022: v }))}
          label="TOKEN-2022 (REBASED TOKEN)"
        />
        {form.token2022 && (
          <div style={styles.toggleContent}>
            <div style={styles.field}>
              <Label>TRANSFER FEE %</Label>
              <NumberInput
                value={form.transferFeeBps / 100}
                onChange={(v) => setForm((f) => ({ ...f, transferFeeBps: Math.min(1000, Math.max(0, Math.round(v * 100))) }))}
                min={0}
                max={10}
                step={0.1}
              />
              <Hint>{(form.transferFeeBps / 100).toFixed(1)}% fee on every transfer</Hint>
            </div>
            <div style={styles.field}>
              <Label>MAX FEE PER TRANSFER (TOKENS)</Label>
              <NumberInput
                value={form.maxTransferFeeTokens}
                onChange={(v) => setForm((f) => ({ ...f, maxTransferFeeTokens: Math.max(0, v) }))}
                min={0}
                step={1000}
              />
              <Hint>0 = no cap on transfer fee</Hint>
            </div>
          </div>
        )}
      </div>

      {/* Vesting */}
      <div style={styles.toggleSection}>
        <Toggle
          checked={form.vestingEnabled}
          onChange={(v) => setForm((f) => ({ ...f, vestingEnabled: v }))}
          label="VESTING (+20 BASED SCORE)"
        />
        {form.vestingEnabled && (
          <div style={styles.toggleContent}>
            <div style={styles.field}>
              <Label>% OF SUPPLY TO VEST</Label>
              <div style={styles.sliderRow}>
                <input
                  type="range"
                  style={styles.slider}
                  min={1}
                  max={30}
                  step={1}
                  value={form.vestingPercent}
                  onChange={(e) => setForm((f) => ({ ...f, vestingPercent: parseInt(e.target.value) }))}
                />
                <span style={styles.sliderValue}>{form.vestingPercent}%</span>
              </div>
              <Hint>
                {fmtNumber(Math.round(form.supply * form.vestingPercent / 100))} tokens locked for vesting
              </Hint>
            </div>
            <div style={styles.twoCol}>
              <div style={styles.field}>
                <Label>CLIFF (DAYS)</Label>
                <NumberInput
                  value={form.cliffDays}
                  onChange={(v) => setForm((f) => ({ ...f, cliffDays: Math.max(0, Math.round(v)) }))}
                  min={0}
                  max={3650}
                />
              </div>
              <div style={styles.field}>
                <Label>UNLOCK PERIOD (DAYS)</Label>
                <NumberInput
                  value={form.unlockDays}
                  onChange={(v) => setForm((f) => ({ ...f, unlockDays: Math.max(1, Math.round(v)) }))}
                  min={1}
                  max={3650}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Initial Buy */}
      <div style={styles.toggleSection}>
        <Toggle
          checked={form.initialBuyEnabled}
          onChange={(v) => setForm((f) => ({ ...f, initialBuyEnabled: v, initialBuySol: v ? 0.1 : 0 }))}
          label="INITIAL BUY AT LAUNCH"
        />
        {form.initialBuyEnabled && (
          <div style={styles.toggleContent}>
            <div style={styles.field}>
              <Label>SOL AMOUNT TO BUY</Label>
              <NumberInput
                value={form.initialBuySol}
                onChange={(v) => setForm((f) => ({ ...f, initialBuySol: Math.max(0, v) }))}
                min={0}
                step={0.1}
              />
            </div>
            {estimatedTokens > 0 && (
              <div style={styles.estimateBox}>
                <span style={styles.estimateLabel}>ESTIMATED TOKENS RECEIVED</span>
                <span style={styles.estimateValue}>≈ {fmtNumber(estimatedTokens)}</span>
              </div>
            )}
            <Hint>
              ⚠ Large initial buys reduce based score. Keep it under 1 SOL.
            </Hint>
          </div>
        )}
      </div>

      {/* Creator Fees */}
      <div style={styles.toggleSection}>
        <div style={styles.toggleLabel2}>CREATOR FEE TYPE</div>
        <div style={styles.radioGroup}>
          <button
            style={{
              ...styles.radioBtn,
              ...(form.creatorFeeOn === CpmmCreatorFeeOn.OnlyTokenB ? styles.radioBtnActive : {}),
            }}
            onClick={() => setForm((f) => ({ ...f, creatorFeeOn: CpmmCreatorFeeOn.OnlyTokenB }))}
          >
            SOL ONLY (RECOMMENDED)
          </button>
          <button
            style={{
              ...styles.radioBtn,
              ...(form.creatorFeeOn === CpmmCreatorFeeOn.BothToken ? styles.radioBtnActive : {}),
            }}
            onClick={() => setForm((f) => ({ ...f, creatorFeeOn: CpmmCreatorFeeOn.BothToken }))}
          >
            BOTH TOKENS
          </button>
        </div>
        <Hint>SOL only = simpler, no sell pressure from creator fees</Hint>
      </div>
    </Card>
  );
}

function Step4({
  form,
  status,
  error,
  txIds,
  onLaunch,
}: {
  form: FormState;
  status: 'idle' | 'uploading' | 'building' | 'signing' | 'sending' | 'done';
  error: string | null;
  txIds: string[];
  onLaunch: () => void;
}) {
  const { publicKey, signAllTransactions } = useWallet();
  const { setVisible } = useWalletModal();

  const sellA = Math.round(form.supply * form.curvePercent / 100);
  const vestA = form.vestingEnabled ? Math.round(form.supply * form.vestingPercent / 100) : 0;
  const networkFeeEstimate = 0.015;
  const totalSol =
    LAUNCH_FEE_LAMPORTS / LAMPORTS_PER_SOL
    + networkFeeEstimate
    + (form.initialBuyEnabled ? form.initialBuySol : 0);

  const busy = status !== 'idle' && status !== 'done';

  const statusLabel: Record<typeof status, string> = {
    idle: '',
    uploading: 'UPLOADING METADATA...',
    building: 'BUILDING TRANSACTIONS...',
    signing: 'WAITING FOR WALLET SIGNATURE...',
    sending: 'SUBMITTING TO SOLANA...',
    done: 'LAUNCH COMPLETE!',
  };

  return (
    <Card>
      <div style={styles.stepTitle}>STEP 4 · REVIEW &amp; LAUNCH</div>

      {/* Summary table */}
      <div style={styles.reviewTable}>
        <ReviewRow label="TOKEN NAME" value={form.tokenName || '—'} />
        <ReviewRow label="SYMBOL" value={form.tokenSymbol || '—'} />
        <ReviewRow label="DECIMALS" value={String(form.decimals)} />
        <ReviewRow label="TOTAL SUPPLY" value={fmtNumber(form.supply)} />
        <ReviewRow label="SOLD ON CURVE" value={`${fmtNumber(sellA)} (${form.curvePercent.toFixed(2)}%)`} />
        <ReviewRow label="FUNDRAISE TARGET" value={`${form.targetSol} SOL`} />
        <ReviewRow label="VESTING" value={form.vestingEnabled ? `${fmtNumber(vestA)} (${form.vestingPercent}%)` : 'NONE'} />
        {form.vestingEnabled && (
          <>
            <ReviewRow label="CLIFF" value={`${form.cliffDays} DAYS`} />
            <ReviewRow label="UNLOCK PERIOD" value={`${form.unlockDays} DAYS`} />
          </>
        )}
        <ReviewRow label="TOKEN-2022" value={form.token2022 ? 'YES' : 'NO'} />
        {form.token2022 && form.transferFeeBps > 0 && (
          <ReviewRow label="TRANSFER FEE" value={`${(form.transferFeeBps / 100).toFixed(1)}%`} />
        )}
        <ReviewRow label="INITIAL BUY" value={form.initialBuyEnabled ? `${form.initialBuySol} SOL` : 'NONE'} />
        <ReviewRow label="CREATOR FEES" value={form.creatorFeeOn === CpmmCreatorFeeOn.OnlyTokenB ? 'SOL ONLY' : 'BOTH TOKENS'} />
      </div>

      {/* Cost breakdown */}
      <div style={styles.costCard}>
        <div style={styles.costTitle}>ESTIMATED COSTS</div>
        <div style={styles.costRows}>
          <CostRow label="BASEDFARMS LAUNCH FEE" value={`${(LAUNCH_FEE_LAMPORTS / LAMPORTS_PER_SOL).toFixed(2)} SOL`} />
          <CostRow label="NETWORK FEES" value={`≈ ${networkFeeEstimate} SOL`} />
          {form.initialBuyEnabled && form.initialBuySol > 0 && (
            <CostRow label="INITIAL BUY" value={`${form.initialBuySol} SOL`} />
          )}
          <div style={styles.costDivider} />
          <CostRow label="TOTAL" value={`≈ ${totalSol.toFixed(3)} SOL`} bold />
        </div>
        <div style={styles.shareNote}>
          + 0.3% of all bonding-curve trades routed to BASEDFARMS
        </div>
      </div>

      {/* Status / error */}
      {busy && (
        <div style={styles.statusBox}>
          <span style={styles.spinner}>◌</span>
          <span style={styles.statusText}>{statusLabel[status]}</span>
        </div>
      )}
      {error && (
        <div style={styles.errorBox}>
          <span style={styles.errorTitle}>ERROR</span>
          <span style={styles.errorMsg}>{error}</span>
        </div>
      )}

      {/* Success */}
      {status === 'done' && txIds.length > 0 && (
        <div style={styles.successBox}>
          <div style={styles.successTitle}>🚀 TOKEN LAUNCHED!</div>
          <div style={styles.txList}>
            {txIds.map((sig, i) => (
              <a
                key={sig}
                href={`https://solscan.io/tx/${sig}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.txLink}
              >
                TX {i + 1} ↗ {sig.slice(0, 12)}...{sig.slice(-6)}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      {status !== 'done' && (
        !publicKey ? (
          <button style={styles.launchBtn} onClick={() => setVisible(true)}>
            CONNECT WALLET TO LAUNCH
          </button>
        ) : !signAllTransactions ? (
          <div style={styles.errorBox}>
            <span style={styles.errorMsg}>Your wallet does not support signAllTransactions. Please use Phantom or Backpack.</span>
          </div>
        ) : (
          <button
            style={{ ...styles.launchBtn, ...(busy ? styles.launchBtnDisabled : {}) }}
            onClick={onLaunch}
            disabled={busy}
          >
            {busy ? statusLabel[status] : '🚀 LAUNCH TOKEN'}
          </button>
        )
      )}

      {status === 'done' && (
        <Link href="/" style={styles.doneBtn}>
          ← BACK TO HOME
        </Link>
      )}
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.reviewRow}>
      <span style={styles.reviewLabel}>{label}</span>
      <span style={styles.reviewValue}>{value}</span>
    </div>
  );
}

function CostRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={styles.costRow}>
      <span style={{ ...styles.costLabel, ...(bold ? { color: '#e879f9' } : {}) }}>{label}</span>
      <span style={{ ...styles.costValue, ...(bold ? { color: '#e879f9', fontSize: '10px' } : {}) }}>{value}</span>
    </div>
  );
}

/* ── Progress Indicator ───────────────────────────────────────────────────── */

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div style={styles.progressBar}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={styles.progressStep}>
          <div style={{
            ...styles.progressDot,
            background: i < step ? '#db2777' : i === step - 1 ? '#db2777' : '#1e0035',
            borderColor: i === step - 1 ? '#db2777' : i < step ? '#db2777' : '#3b0764',
            boxShadow: i === step - 1 ? '0 0 12px rgba(219, 39, 119, 0.8)' : 'none',
          }}>
            {i < step ? '✓' : i + 1}
          </div>
          {i < total - 1 && (
            <div style={{
              ...styles.progressLine,
              background: i < step - 1 ? '#db2777' : '#1e0035',
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */

const STEPS = ['TOKEN BASICS', 'SUPPLY & CURVE', 'ADVANCED', 'REVIEW'];

export default function LaunchPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(DEFAULT);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'building' | 'signing' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txIds, setTxIds] = useState<string[]>([]);

  const { publicKey, signAllTransactions } = useWallet();

  const canNext = (() => {
    if (step === 1) return form.tokenName.trim().length > 0 && form.tokenSymbol.trim().length > 0;
    if (step === 2) return form.supply > 0 && form.curvePercent >= 20 && form.targetSol > 0;
    return true;
  })();

  const handleLaunch = useCallback(async () => {
    if (!publicKey || !signAllTransactions) return;
    setError(null);

    try {
      // Step 1: upload metadata
      setStatus('uploading');
      const metadataUri = await uploadMetadata({
        name: form.tokenName,
        symbol: form.tokenSymbol,
        description: form.description,
        imageDataUri: form.imageDataUri,
      });

      // Step 2: build params
      setStatus('building');
      const params: LaunchParams = {
        name: form.tokenName,
        symbol: form.tokenSymbol,
        description: form.description,
        imageDataUri: form.imageDataUri,
        decimals: form.decimals,
        supply: form.supply,
        curvePercent: form.curvePercent,
        targetSol: form.targetSol,
        token2022: form.token2022,
        transferFeeBps: form.transferFeeBps,
        maxTransferFeeRaw: BigInt(
          Math.round(form.maxTransferFeeTokens * Math.pow(10, form.decimals)),
        ),
        vestingEnabled: form.vestingEnabled,
        vestingPercent: form.vestingPercent,
        cliffSeconds: form.cliffDays * 86400,
        unlockSeconds: form.unlockDays * 86400,
        initialBuyLamports: form.initialBuyEnabled
          ? Math.round(form.initialBuySol * LAMPORTS_PER_SOL)
          : 0,
        creatorFeeOn: form.creatorFeeOn,
      };

      // Step 3: sign (wallet prompt)
      setStatus('signing');
      const typedSignAll = signAllTransactions as (txs: Transaction[]) => Promise<Transaction[]>;

      // Step 4: send
      setStatus('sending');
      const result = await createToken(params, metadataUri, publicKey, typedSignAll);

      setTxIds(result.txIds);
      setStatus('done');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('idle');
      console.error('[Launch] error:', err);
    }
  }, [form, publicKey, signAllTransactions]);

  // Redirect to farm page on success
  useEffect(() => {
    // txIds[0] won't give us mint address — we'd need the result object
    // For now, just mark done and show the tx links
  }, [txIds]);

  return (
    <main style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <Link href="/" style={styles.logo}>
          BASED<span style={styles.logoAccent}>FARMS</span>
        </Link>
        <div style={styles.headerRight}>
          <span style={styles.headerLabel}>LAUNCH TOKEN</span>
        </div>
      </header>

      {/* Progress */}
      <ProgressBar step={step} total={STEPS.length} />

      <div style={styles.layout}>
        {/* Form column */}
        <div style={styles.formCol}>
          {step === 1 && <Step1 form={form} setForm={setForm} />}
          {step === 2 && <Step2 form={form} setForm={setForm} />}
          {step === 3 && <Step3 form={form} setForm={setForm} />}
          {step === 4 && (
            <Step4
              form={form}
              status={status}
              error={error}
              txIds={txIds}
              onLaunch={handleLaunch}
            />
          )}

          {/* Navigation */}
          {step < 4 && (
            <div style={styles.navRow}>
              {step > 1 && (
                <button
                  style={styles.backBtn}
                  onClick={() => setStep((s) => s - 1)}
                >
                  ← BACK
                </button>
              )}
              <button
                style={{ ...styles.nextBtn, ...(canNext ? {} : styles.nextBtnDisabled) }}
                onClick={() => { if (canNext) setStep((s) => s + 1); }}
                disabled={!canNext}
              >
                {step === 3 ? 'REVIEW →' : 'NEXT →'}
              </button>
            </div>
          )}
        </div>

        {/* Score sidebar */}
        <div style={styles.scoreCol}>
          <BasedScorePanel form={form} />
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        POWERED BY RAYDIUM LAUNCHLAB · BASED FARMS · 0.1 SOL LAUNCH FEE
      </div>
    </main>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0d0015',
    padding: '0 0 60px',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #1e0035',
    background: 'rgba(13, 0, 21, 0.95)',
    backdropFilter: 'blur(10px)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  logo: {
    fontFamily: font,
    fontSize: '12px',
    letterSpacing: '2px',
    color: '#c084fc',
    textDecoration: 'none',
    textShadow: '0 0 10px rgba(192, 132, 252, 0.4)',
  },
  logoAccent: { color: '#db2777' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  headerLabel: {
    fontFamily: font,
    fontSize: '8px',
    color: '#e879f9',
    letterSpacing: '2px',
    textShadow: '0 0 8px rgba(232, 121, 249, 0.5)',
  },
  progressBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px 20px 8px',
    gap: 0,
  },
  progressStep: {
    display: 'flex',
    alignItems: 'center',
  },
  progressDot: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: font,
    fontSize: '7px',
    color: '#ffffff',
    flexShrink: 0,
    transition: 'all 0.2s ease',
    cursor: 'default',
  },
  progressLine: {
    width: '40px',
    height: '2px',
    transition: 'background 0.2s ease',
  },
  layout: {
    display: 'flex',
    gap: '20px',
    maxWidth: '1000px',
    margin: '20px auto 0',
    padding: '0 16px',
    alignItems: 'flex-start',
    boxSizing: 'border-box',
  },
  formCol: {
    flex: '1 1 0',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  scoreCol: {
    width: '260px',
    flexShrink: 0,
    position: 'sticky',
    top: '80px',
  },
  card: {
    background: 'rgba(13, 0, 32, 0.9)',
    border: '1px solid #3b0764',
    borderRadius: '14px',
    padding: '24px',
    boxShadow: '0 0 30px rgba(124, 58, 237, 0.15), inset 0 0 30px rgba(88, 28, 135, 0.05)',
    animation: 'border-glow 4s ease-in-out infinite',
  },
  stepTitle: {
    fontFamily: font,
    fontSize: '9px',
    letterSpacing: '2px',
    color: '#e879f9',
    textShadow: '0 0 8px rgba(232, 121, 249, 0.5)',
    marginBottom: '24px',
    paddingBottom: '12px',
    borderBottom: '1px solid #1e0035',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '18px',
  },
  label: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1.5px',
    color: '#7c3aed',
  },
  required: { color: '#db2777' },
  hint: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '1px',
    color: '#4c1d95',
  },
  input: {
    background: '#0d0020',
    border: '1px solid #3b0764',
    borderRadius: '8px',
    padding: '10px 12px',
    color: '#c084fc',
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  },
  inputDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  textarea: {
    background: '#0d0020',
    border: '1px solid #3b0764',
    borderRadius: '8px',
    padding: '10px 12px',
    color: '#c084fc',
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
    lineHeight: 1.8,
  },
  imageUpload: {
    border: '2px dashed',
    borderRadius: '12px',
    padding: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    minHeight: '120px',
    transition: 'border-color 0.2s',
    background: 'rgba(13, 0, 32, 0.5)',
  },
  imageUploadInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  imageUploadIcon: {
    fontSize: '32px',
    color: '#3b0764',
  },
  imageUploadText: {
    fontFamily: font,
    fontSize: '8px',
    color: '#6d28d9',
    letterSpacing: '2px',
  },
  imageUploadHint: {
    fontFamily: font,
    fontSize: '6px',
    color: '#3b0764',
    letterSpacing: '1px',
  },
  imagePreview: {
    width: '96px',
    height: '96px',
    borderRadius: '12px',
    objectFit: 'cover',
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontFamily: font,
    fontSize: '6px',
    color: '#4c1d95',
    letterSpacing: '1px',
    textAlign: 'left',
    padding: 0,
  },
  radioGroup: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  radioBtn: {
    background: 'rgba(88, 28, 135, 0.1)',
    border: '1px solid #3b0764',
    borderRadius: '6px',
    padding: '8px 14px',
    color: '#6d28d9',
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  radioBtnActive: {
    background: 'rgba(219, 39, 119, 0.2)',
    borderColor: '#db2777',
    color: '#db2777',
    boxShadow: '0 0 8px rgba(219, 39, 119, 0.3)',
  },
  sliderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  slider: {
    flex: 1,
    accentColor: '#db2777',
    cursor: 'pointer',
  },
  sliderValue: {
    fontFamily: font,
    fontSize: '8px',
    color: '#db2777',
    minWidth: '50px',
    textAlign: 'right',
    textShadow: '0 0 8px rgba(219, 39, 119, 0.5)',
  },
  curveStats: {
    display: 'flex',
    gap: '12px',
  },
  curveStat: {
    flex: 1,
    background: 'rgba(88, 28, 135, 0.1)',
    border: '1px solid #1e0035',
    borderRadius: '8px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  curveStatLabel: {
    fontFamily: font,
    fontSize: '6px',
    color: '#4c1d95',
    letterSpacing: '1px',
  },
  curveStatValue: {
    fontFamily: font,
    fontSize: '8px',
    color: '#c084fc',
  },
  curveTypeBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'rgba(88, 28, 135, 0.08)',
    border: '1px solid #1e0035',
    borderRadius: '8px',
    padding: '10px 14px',
  },
  curveTypeLabel: {
    fontFamily: font,
    fontSize: '7px',
    color: '#4c1d95',
    letterSpacing: '1px',
  },
  curveTypeBadge: {
    fontFamily: font,
    fontSize: '7px',
    color: '#7c3aed',
    letterSpacing: '1px',
  },
  toggleSection: {
    borderBottom: '1px solid #1e0035',
    paddingBottom: '16px',
    marginBottom: '16px',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
    userSelect: 'none',
    marginBottom: '12px',
  },
  toggleTrack: {
    width: '44px',
    height: '24px',
    borderRadius: '12px',
    position: 'relative',
    transition: 'background 0.2s',
    flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute',
    top: '4px',
    left: '4px',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    background: '#ffffff',
    transition: 'transform 0.2s',
  },
  toggleLabel: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    color: '#c084fc',
  },
  toggleLabel2: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1.5px',
    color: '#7c3aed',
    marginBottom: '10px',
  },
  toggleContent: {
    paddingLeft: '54px',
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  estimateBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(219, 39, 119, 0.08)',
    border: '1px solid rgba(219, 39, 119, 0.3)',
    borderRadius: '8px',
    padding: '10px 14px',
    marginBottom: '8px',
  },
  estimateLabel: {
    fontFamily: font,
    fontSize: '6px',
    color: '#db2777',
    letterSpacing: '1px',
  },
  estimateValue: {
    fontFamily: font,
    fontSize: '9px',
    color: '#db2777',
    textShadow: '0 0 8px rgba(219, 39, 119, 0.5)',
  },
  // Review step
  reviewTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    marginBottom: '20px',
    border: '1px solid #1e0035',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  reviewRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '1px solid #0d0020',
    gap: '12px',
  },
  reviewLabel: {
    fontFamily: font,
    fontSize: '6px',
    color: '#4c1d95',
    letterSpacing: '1px',
    flexShrink: 0,
  },
  reviewValue: {
    fontFamily: font,
    fontSize: '7px',
    color: '#c084fc',
    letterSpacing: '1px',
    textAlign: 'right',
    wordBreak: 'break-all',
  },
  costCard: {
    background: 'rgba(88, 28, 135, 0.08)',
    border: '1px solid #3b0764',
    borderRadius: '10px',
    padding: '16px',
    marginBottom: '20px',
  },
  costTitle: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    color: '#7c3aed',
    marginBottom: '12px',
  },
  costRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  costRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  costLabel: {
    fontFamily: font,
    fontSize: '6px',
    color: '#6d28d9',
    letterSpacing: '1px',
  },
  costValue: {
    fontFamily: font,
    fontSize: '7px',
    color: '#c084fc',
  },
  costDivider: {
    height: '1px',
    background: '#1e0035',
    margin: '4px 0',
  },
  shareNote: {
    fontFamily: font,
    fontSize: '6px',
    color: '#3b0764',
    letterSpacing: '1px',
    marginTop: '10px',
    textAlign: 'center',
  },
  statusBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px',
    background: 'rgba(124, 58, 237, 0.1)',
    border: '1px solid #7c3aed',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  spinner: {
    fontFamily: font,
    fontSize: '14px',
    color: '#7c3aed',
    animation: 'pulse 1s ease-in-out infinite',
  },
  statusText: {
    fontFamily: font,
    fontSize: '7px',
    color: '#a855f7',
    letterSpacing: '1.5px',
  },
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '14px',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  errorTitle: {
    fontFamily: font,
    fontSize: '7px',
    color: '#ef4444',
    letterSpacing: '2px',
  },
  errorMsg: {
    fontFamily: font,
    fontSize: '7px',
    color: '#fca5a5',
    letterSpacing: '0.5px',
    lineHeight: 1.8,
    wordBreak: 'break-word',
  },
  successBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    background: 'rgba(34, 197, 94, 0.08)',
    border: '1px solid #22c55e',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  successTitle: {
    fontFamily: font,
    fontSize: '9px',
    color: '#22c55e',
    letterSpacing: '2px',
    textShadow: '0 0 10px rgba(34, 197, 94, 0.5)',
  },
  txList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  txLink: {
    fontFamily: font,
    fontSize: '7px',
    color: '#22c55e',
    textDecoration: 'none',
    letterSpacing: '1px',
  },
  launchBtn: {
    width: '100%',
    padding: '16px',
    background: 'linear-gradient(135deg, #db2777 0%, #7c3aed 100%)',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
    fontFamily: font,
    fontSize: '10px',
    letterSpacing: '2px',
    cursor: 'pointer',
    boxShadow: '0 0 20px rgba(219, 39, 119, 0.4)',
    transition: 'opacity 0.2s, box-shadow 0.2s',
  },
  launchBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  doneBtn: {
    display: 'block',
    width: '100%',
    padding: '14px',
    background: 'rgba(88, 28, 135, 0.2)',
    border: '1px solid #3b0764',
    borderRadius: '10px',
    color: '#c084fc',
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '2px',
    cursor: 'pointer',
    textAlign: 'center',
    textDecoration: 'none',
    boxSizing: 'border-box',
  },
  // Navigation
  navRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
  },
  backBtn: {
    flex: 1,
    padding: '12px',
    background: 'transparent',
    border: '1px solid #3b0764',
    borderRadius: '8px',
    color: '#6d28d9',
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '2px',
    cursor: 'pointer',
  },
  nextBtn: {
    flex: 2,
    padding: '12px',
    background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
    border: 'none',
    borderRadius: '8px',
    color: '#ffffff',
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '2px',
    cursor: 'pointer',
    boxShadow: '0 0 14px rgba(124, 58, 237, 0.4)',
  },
  nextBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  // Score panel
  scorePanel: {
    background: 'rgba(13, 0, 32, 0.95)',
    border: '1px solid #3b0764',
    borderRadius: '14px',
    padding: '20px',
    boxShadow: '0 0 20px rgba(124, 58, 237, 0.1)',
  },
  scorePanelTitle: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '2px',
    color: '#e879f9',
    textShadow: '0 0 8px rgba(232, 121, 249, 0.5)',
    marginBottom: '16px',
    textAlign: 'center',
  },
  scoreCircle: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: '4px',
    marginBottom: '12px',
  },
  scoreNumber: {
    fontFamily: font,
    fontSize: '36px',
    lineHeight: 1,
    textShadow: '0 0 20px currentColor',
    transition: 'color 0.3s',
  },
  scoreMax: {
    fontFamily: font,
    fontSize: '10px',
    color: '#3b0764',
  },
  scoreBarTrack: {
    height: '4px',
    background: '#1e0035',
    borderRadius: '2px',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease, background 0.3s ease',
  },
  scoreLabel: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1.5px',
    color: '#6d28d9',
    textAlign: 'center',
    marginBottom: '16px',
  },
  scoreItems: {
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
  },
  scoreItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '7px',
  },
  scoreItemLabel: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '0.5px',
    lineHeight: 1.5,
    flex: 1,
    transition: 'color 0.2s',
  },
  scoreItemPts: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '1px',
    flexShrink: 0,
    transition: 'color 0.2s',
  },
  // Footer
  footer: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1.5px',
    color: '#1e0035',
    textAlign: 'center',
    marginTop: '40px',
    padding: '0 20px',
  },
};
