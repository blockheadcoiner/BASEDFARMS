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
  type ScoreTouchedKey,
} from '@/services/launch';
import { useWalletModal } from '@/components/WalletProvider';

const font = 'var(--font-press-start), "Courier New", monospace';

/* ── Responsive hook ──────────────────────────────────────────────────────── */

function useMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return mobile;
}

/* ── Animated score counter ──────────────────────────────────────────────── */

function useAnimatedScore(target: number): number {
  const [displayed, setDisplayed] = useState(0);
  const rafRef = useRef<number>(0);
  const fromRef = useRef(0);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const start = fromRef.current;
    const end = target;
    if (start === end) return;
    const duration = 500;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplayed(Math.round(start + (end - start) * eased));
      if (p < 1) { rafRef.current = requestAnimationFrame(tick); }
      else { fromRef.current = end; }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);

  return displayed;
}

/* ── Form state ───────────────────────────────────────────────────────────── */

interface FormState {
  tokenName: string;
  tokenSymbol: string;
  description: string;
  imageDataUri: string;
  decimals: 6 | 9;
  supply: number;
  curvePercent: number;
  targetSol: number;
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

/* ── Shared micro-components ──────────────────────────────────────────────── */

function Card({
  children,
  style,
  isMobile,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  isMobile?: boolean;
}) {
  return (
    <div
      style={{
        ...s.card,
        padding: isMobile ? '16px' : '24px',
        borderRadius: isMobile ? '10px' : '14px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={s.label}>{children}</div>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={s.hint}>{children}</div>;
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
      style={{ ...s.input, ...(disabled ? s.inputDisabled : {}) }}
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
      style={{ ...s.input, ...(disabled ? s.inputDisabled : {}) }}
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
      style={s.toggleRow}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onChange(!checked);
      }}
    >
      <div
        style={{
          ...s.toggleTrack,
          background: checked ? '#db2777' : '#1e0035',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            ...s.toggleThumb,
            transform: checked ? 'translateX(20px)' : 'translateX(0)',
          }}
        />
      </div>
      <span style={s.toggleLabel}>{label}</span>
    </div>
  );
}

/* ── Based Score Panel ────────────────────────────────────────────────────── */

/** Tier config keyed by rawTotal threshold (descending) */
const TIERS: { min: number; label: string; color: string }[] = [
  { min: 101, label: 'MAXIMUM BASED 🔥', color: '#f59e0b' },
  { min: 90,  label: 'ULTRA BASED',      color: '#06b6d4' },
  { min: 75,  label: 'BASED',            color: '#22c55e' },
  { min: 50,  label: 'SOMEWHAT BASED',   color: '#eab308' },
  { min: 25,  label: 'QUESTIONABLE',     color: '#f97316' },
  { min: 0,   label: 'NOT BASED',        color: '#ef4444' },
];

function getTier(rawTotal: number) {
  return TIERS.find((t) => rawTotal >= t.min) ?? TIERS[TIERS.length - 1];
}

const SCORE_CATEGORIES = ['BASICS', 'SUPPLY', 'CURVE & FUNDRAISE', 'ADVANCED'] as const;

/** The Based Points section — gold-themed, shown below the score items */
function BasedPointsSection() {
  return (
    <div style={s.basedPointsPanel}>
      <div style={s.basedPointsTitle}>◈ BASED POINTS</div>
      <div style={s.basedPointsRows}>
        {[
          { icon: '◎', event: 'LAUNCH TOKEN',   pts: '+1,000' },
          { icon: '▲', event: 'GRADUATION',      pts: '+10,000' },
          { icon: '⬡', event: 'PER $100 VOLUME', pts: '+10' },
        ].map(({ icon, event, pts }) => (
          <div key={event} style={s.basedPointsRow}>
            <span style={s.basedPointsIcon}>{icon}</span>
            <span style={s.basedPointsEvent}>{event}</span>
            <span style={s.basedPointsValue}>{pts}</span>
          </div>
        ))}
      </div>
      <div style={s.basedPointsHint}>Based Points may qualify for future rewards</div>
      <div style={s.basedPointsHint}>Points tracked on-chain at graduation</div>
    </div>
  );
}

function ScoreItemsList({
  items,
  scoreColor,
}: {
  items: ReturnType<typeof calcBasedScore>['items'];
  scoreColor: string;
}) {
  return (
    <div style={s.scoreItems}>
      {SCORE_CATEGORIES.map((cat) => {
        const catItems = items.filter((i) => i.category === cat);
        if (!catItems.length) return null;
        return (
          <div key={cat}>
            <div style={s.scoreCategory}>{cat}</div>
            {catItems.map((item) => (
              <div key={item.label} style={s.scoreItem}>
                <span style={{ color: item.earned ? '#22c55e' : '#3b0764', fontSize: '8px', flexShrink: 0 }}>
                  {item.earned ? '✓' : '○'}
                </span>
                <span style={{ ...s.scoreItemLabel, color: item.earned ? '#c084fc' : '#4c1d95' }}>
                  {item.label}
                </span>
                <span style={{ ...s.scoreItemPts, color: item.earned ? scoreColor : '#3b0764' }}>
                  +{item.pts}
                </span>
              </div>
            ))}
          </div>
        );
      })}
      {/* Based bonus rows — gold accent */}
      {items
        .filter((i) => i.bonus)
        .map((item) => (
          <div key={item.label} style={{ ...s.scoreItem, ...s.basedBonusRow }}>
            <span style={{ color: '#f59e0b', fontSize: '8px', flexShrink: 0 }}>✦</span>
            <span style={{ ...s.scoreItemLabel, color: '#fbbf24' }}>{item.label}</span>
            <span style={{ ...s.scoreItemPts, color: '#f59e0b' }}>+{item.pts}</span>
          </div>
        ))}
    </div>
  );
}

function BasedScorePanel({
  form,
  touched,
  isMobile,
  expanded,
  onToggle,
}: {
  form: FormState;
  touched: Set<ScoreTouchedKey>;
  isMobile: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const scoreParams: Partial<LaunchParams> & { imageDataUri?: string } = {
    name: form.tokenName,
    symbol: form.tokenSymbol,
    vestingEnabled: form.vestingEnabled,
    supply: form.supply,
    curvePercent: form.curvePercent,
    targetSol: form.targetSol,
    creatorFeeOn: form.creatorFeeOn,
    imageDataUri: form.imageDataUri,
  };

  const { total, rawTotal, hasBasedBonus, basedBonusPts, items } = calcBasedScore(scoreParams, touched);
  const { label: tierLabel, color: tierColor } = getTier(rawTotal);
  const displayedScore = useAnimatedScore(total);

  // On mobile: compact header always visible; breakdown collapsible
  if (isMobile) {
    return (
      <div style={s.scorePanelMobile}>
        <div
          style={s.scoreMobileHeader}
          onClick={onToggle}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
          aria-expanded={expanded}
        >
          <span style={s.scorePanelTitle}>◈ BASED SCORE</span>
          <div style={s.scoreMobileSummary}>
            <span style={{ ...s.scoreMobileNumber, color: tierColor }}>{displayedScore}</span>
            <span style={{ ...s.scoreMobileTier, color: tierColor }}>{tierLabel}</span>
            <span style={s.scoreExpandIcon}>{expanded ? '▲' : '▼'}</span>
          </div>
        </div>

        <div style={s.scoreBarTrack}>
          <div style={{ ...s.scoreBarFill, width: `${total}%`, background: tierColor, boxShadow: `0 0 6px ${tierColor}` }} />
        </div>

        {hasBasedBonus && (
          <div style={s.basedBonusBadge}>✦ BASED BONUS! 🔥 +{basedBonusPts}</div>
        )}

        {expanded && (
          <div style={s.scoreMobileBreakdown}>
            <ScoreItemsList items={items} scoreColor={tierColor} />
            <BasedPointsSection />
          </div>
        )}
      </div>
    );
  }

  // Desktop: full panel, no toggle
  return (
    <div style={s.scorePanel}>
      <div style={s.scorePanelTitle}>◈ BASED SCORE</div>

      <div style={s.scoreCircle}>
        <span style={{ ...s.scoreNumber, color: tierColor }}>{displayedScore}</span>
        <span style={s.scoreMax}>/100</span>
      </div>

      <div style={s.scoreBarTrack}>
        <div style={{ ...s.scoreBarFill, width: `${total}%`, background: tierColor, boxShadow: `0 0 8px ${tierColor}` }} />
      </div>

      {hasBasedBonus && (
        <div style={s.basedBonusBadge}>✦ BASED BONUS! 🔥 +{basedBonusPts}</div>
      )}

      <div style={{ ...s.scoreLabel, color: tierColor }}>{tierLabel}</div>

      <ScoreItemsList items={items} scoreColor={tierColor} />

      <div style={s.scoreDivider} />
      <BasedPointsSection />
    </div>
  );
}

/* ── Step 1 ───────────────────────────────────────────────────────────────── */

function Step1({
  form,
  setForm,
  isMobile,
  onTouch,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  isMobile: boolean;
  onTouch: (key: ScoreTouchedKey) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImage = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        alert('Image must be under 2MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = (evt) => {
        setForm((f) => ({
          ...f,
          imageDataUri: (evt.target?.result as string) ?? '',
        }));
      };
      reader.readAsDataURL(file);
    },
    [setForm],
  );

  return (
    <Card isMobile={isMobile}>
      <div style={s.stepTitle}>STEP 1 · TOKEN BASICS</div>

      <div style={s.field}>
        <Label>
          TOKEN NAME <span style={s.required}>*</span>
        </Label>
        <TextInput
          value={form.tokenName}
          onChange={(v) => setForm((f) => ({ ...f, tokenName: v }))}
          placeholder="e.g. Based Goose Money"
          maxLength={32}
        />
        <Hint>{form.tokenName.length}/32 characters</Hint>
      </div>

      <div style={s.field}>
        <Label>
          TOKEN SYMBOL <span style={s.required}>*</span>
        </Label>
        <TextInput
          value={form.tokenSymbol}
          onChange={(v) => setForm((f) => ({ ...f, tokenSymbol: v.toUpperCase() }))}
          placeholder="e.g. BGM"
          maxLength={10}
        />
        <Hint>{form.tokenSymbol.length}/10 characters</Hint>
      </div>

      <div style={s.field}>
        <Label>DESCRIPTION</Label>
        <textarea
          style={s.textarea}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Tell the world about your token..."
          rows={3}
        />
      </div>

      <div style={s.field}>
        <Label>TOKEN IMAGE</Label>
        <div
          style={{
            ...s.imageUpload,
            borderColor: form.imageDataUri ? '#db2777' : '#3b0764',
          }}
          onClick={() => fileRef.current?.click()}
        >
          {form.imageDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.imageDataUri} alt="preview" style={s.imagePreview} />
          ) : (
            <div style={s.imageUploadInner}>
              <span style={s.imageUploadIcon}>◎</span>
              <span style={s.imageUploadText}>CLICK TO UPLOAD</span>
              <span style={s.imageUploadHint}>PNG, JPG, GIF · MAX 2MB</span>
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
            style={s.clearBtn}
            onClick={() => setForm((f) => ({ ...f, imageDataUri: '' }))}
          >
            ✕ REMOVE IMAGE
          </button>
        )}
      </div>

      <div style={s.field}>
        <Label>DECIMALS</Label>
        <div style={s.radioGroup}>
          {([6, 9] as (6 | 9)[]).map((d) => (
            <button
              key={d}
              style={{
                ...s.radioBtn,
                ...(form.decimals === d ? s.radioBtnActive : {}),
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

/* ── Step 2 ───────────────────────────────────────────────────────────────── */

function Step2({
  form,
  setForm,
  isMobile,
  onTouch,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  isMobile: boolean;
  onTouch: (key: ScoreTouchedKey) => void;
}) {
  const sellA = Math.round((form.supply * form.curvePercent) / 100);
  const reserved = form.supply - sellA;

  return (
    <Card isMobile={isMobile}>
      <div style={s.stepTitle}>STEP 2 · SUPPLY &amp; CURVE</div>

      <div style={s.field}>
        <Label>TOTAL SUPPLY</Label>
        <NumberInput
          value={form.supply}
          onChange={(v) => {
            setForm((f) => ({ ...f, supply: Math.max(1, Math.round(v)) }));
            onTouch('supply');
          }}
          min={1}
          step={1_000_000}
        />
        <Hint>{fmtNumber(form.supply)} tokens total</Hint>
      </div>

      <div style={s.field}>
        <Label>% SOLD ON BONDING CURVE</Label>
        <div style={s.sliderRow}>
          <input
            type="range"
            style={{ ...s.slider, width: '100%' }}
            min={20}
            max={100}
            step={0.01}
            value={form.curvePercent}
            onChange={(e) => {
              setForm((f) => ({ ...f, curvePercent: parseFloat(e.target.value) }));
              onTouch('curvePercent');
            }}
          />
          <span style={s.sliderValue}>{form.curvePercent.toFixed(2)}%</span>
        </div>
        {/* Stack vertically on mobile */}
        <div
          style={{
            ...s.curveStats,
            flexDirection: isMobile ? 'column' : 'row',
          }}
        >
          <div style={s.curveStat}>
            <span style={s.curveStatLabel}>ON CURVE</span>
            <span style={s.curveStatValue}>{fmtNumber(sellA)}</span>
          </div>
          <div style={s.curveStat}>
            <span style={s.curveStatLabel}>RESERVED</span>
            <span style={s.curveStatValue}>{fmtNumber(reserved)}</span>
          </div>
        </div>
        <Hint>Higher % = fairer distribution. Raydium default is 79.31%</Hint>
      </div>

      <div style={s.field}>
        <Label>SOL FUNDRAISING TARGET</Label>
        <NumberInput
          value={form.targetSol}
          onChange={(v) => {
            setForm((f) => ({ ...f, targetSol: Math.max(1, v) }));
            onTouch('targetSol');
          }}
          min={1}
          step={5}
        />
        <Hint>SOL raised before graduating to CPMM pool. Raydium default is 85 SOL</Hint>
      </div>

      <div style={s.curveTypeBox}>
        <span style={s.curveTypeLabel}>CURVE TYPE</span>
        <span style={s.curveTypeBadge}>CONSTANT PRODUCT</span>
      </div>
    </Card>
  );
}

/* ── Step 3 ───────────────────────────────────────────────────────────────── */

function Step3({
  form,
  setForm,
  isMobile,
  onTouch,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  isMobile: boolean;
  onTouch: (key: ScoreTouchedKey) => void;
}) {
  const estimatedTokens = (() => {
    if (!form.initialBuyEnabled || form.initialBuySol <= 0) return 0;
    const sellA = (form.supply * form.curvePercent) / 100;
    const virtualB = (sellA * form.targetSol) / (form.supply - sellA || 1);
    const tokensOut = (sellA * form.initialBuySol) / (virtualB + form.initialBuySol);
    return Math.round(tokensOut);
  })();

  // Remove indent on mobile — space is precious
  const toggleContentStyle: React.CSSProperties = {
    ...s.toggleContent,
    paddingLeft: isMobile ? '0' : '54px',
    paddingTop: '12px',
  };

  return (
    <Card isMobile={isMobile}>
      <div style={s.stepTitle}>STEP 3 · ADVANCED OPTIONS</div>

      {/* Token-2022 */}
      <div style={s.toggleSection}>
        <Toggle
          checked={form.token2022}
          onChange={(v) => setForm((f) => ({ ...f, token2022: v }))}
          label="TOKEN-2022 (REBASED TOKEN)"
        />
        {form.token2022 && (
          <div style={toggleContentStyle}>
            <div style={s.field}>
              <Label>TRANSFER FEE %</Label>
              <NumberInput
                value={form.transferFeeBps / 100}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    transferFeeBps: Math.min(1000, Math.max(0, Math.round(v * 100))),
                  }))
                }
                min={0}
                max={10}
                step={0.1}
              />
              <Hint>
                {(form.transferFeeBps / 100).toFixed(1)}% fee on every transfer
              </Hint>
            </div>
            <div style={s.field}>
              <Label>MAX FEE PER TRANSFER (TOKENS)</Label>
              <NumberInput
                value={form.maxTransferFeeTokens}
                onChange={(v) =>
                  setForm((f) => ({ ...f, maxTransferFeeTokens: Math.max(0, v) }))
                }
                min={0}
                step={1000}
              />
              <Hint>0 = no cap on transfer fee</Hint>
            </div>
          </div>
        )}
      </div>

      {/* Vesting */}
      <div style={s.toggleSection}>
        <Toggle
          checked={form.vestingEnabled}
          onChange={(v) => { setForm((f) => ({ ...f, vestingEnabled: v })); onTouch('vestingEnabled'); }}
          label="VESTING"
        />
        {form.vestingEnabled && (
          <div style={toggleContentStyle}>
            <div style={s.field}>
              <Label>% OF SUPPLY TO VEST</Label>
              <div style={s.sliderRow}>
                <input
                  type="range"
                  style={{ ...s.slider, width: '100%' }}
                  min={1}
                  max={30}
                  step={1}
                  value={form.vestingPercent}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, vestingPercent: parseInt(e.target.value) }))
                  }
                />
                <span style={s.sliderValue}>{form.vestingPercent}%</span>
              </div>
              <Hint>
                {fmtNumber(Math.round((form.supply * form.vestingPercent) / 100))}{' '}
                tokens locked for vesting
              </Hint>
            </div>
            {/* Stack cliff/unlock on mobile */}
            <div
              style={{
                ...s.twoCol,
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              }}
            >
              <div style={s.field}>
                <Label>CLIFF (DAYS)</Label>
                <NumberInput
                  value={form.cliffDays}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, cliffDays: Math.max(0, Math.round(v)) }))
                  }
                  min={0}
                  max={3650}
                />
              </div>
              <div style={s.field}>
                <Label>UNLOCK PERIOD (DAYS)</Label>
                <NumberInput
                  value={form.unlockDays}
                  onChange={(v) =>
                    setForm((f) => ({ ...f, unlockDays: Math.max(1, Math.round(v)) }))
                  }
                  min={1}
                  max={3650}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Initial Buy */}
      <div style={s.toggleSection}>
        <Toggle
          checked={form.initialBuyEnabled}
          onChange={(v) => {
            setForm((f) => ({ ...f, initialBuyEnabled: v, initialBuySol: v ? 0.1 : 0 }));
          }}
          label="INITIAL BUY AT LAUNCH"
        />
        {form.initialBuyEnabled && (
          <div style={toggleContentStyle}>
            <div style={s.field}>
              <Label>SOL AMOUNT TO BUY</Label>
              <NumberInput
                value={form.initialBuySol}
                onChange={(v) =>
                  setForm((f) => ({ ...f, initialBuySol: Math.max(0, v) }))
                }
                min={0}
                step={0.1}
              />
            </div>
            {estimatedTokens > 0 && (
              <div style={s.estimateBox}>
                <span style={s.estimateLabel}>ESTIMATED TOKENS RECEIVED</span>
                <span style={s.estimateValue}>≈ {fmtNumber(estimatedTokens)}</span>
              </div>
            )}
            <Hint>⚠ Large initial buys signal insider accumulation — keep it modest.</Hint>
          </div>
        )}
      </div>

      {/* Creator Fees */}
      <div style={s.toggleSection}>
        <div style={s.toggleLabel2}>CREATOR FEE TYPE</div>
        <div style={s.radioGroup}>
          <button
            style={{
              ...s.radioBtn,
              ...(form.creatorFeeOn === CpmmCreatorFeeOn.OnlyTokenB
                ? s.radioBtnActive
                : {}),
            }}
            onClick={() => {
              setForm((f) => ({ ...f, creatorFeeOn: CpmmCreatorFeeOn.OnlyTokenB }));
              onTouch('creatorFeeOn');
            }}
          >
            SOL ONLY (RECOMMENDED)
          </button>
          <button
            style={{
              ...s.radioBtn,
              ...(form.creatorFeeOn === CpmmCreatorFeeOn.BothToken
                ? s.radioBtnActive
                : {}),
            }}
            onClick={() => {
              setForm((f) => ({ ...f, creatorFeeOn: CpmmCreatorFeeOn.BothToken }));
              onTouch('creatorFeeOn');
            }}
          >
            BOTH TOKENS
          </button>
        </div>
        <Hint>SOL only = simpler, no sell pressure from creator fees</Hint>
      </div>
    </Card>
  );
}

/* ── Step 4 ───────────────────────────────────────────────────────────────── */

function Step4({
  form,
  status,
  error,
  txIds,
  onLaunch,
  isMobile,
}: {
  form: FormState;
  status: 'idle' | 'uploading' | 'building' | 'signing' | 'sending' | 'done';
  error: string | null;
  txIds: string[];
  onLaunch: () => void;
  isMobile: boolean;
}) {
  const { publicKey, signAllTransactions } = useWallet();
  const { setVisible } = useWalletModal();

  const sellA = Math.round((form.supply * form.curvePercent) / 100);
  const vestA = form.vestingEnabled
    ? Math.round((form.supply * form.vestingPercent) / 100)
    : 0;
  const networkFeeEstimate = 0.015;
  const totalSol =
    LAUNCH_FEE_LAMPORTS / LAMPORTS_PER_SOL +
    networkFeeEstimate +
    (form.initialBuyEnabled ? form.initialBuySol : 0);

  const busy = status !== 'idle' && status !== 'done';

  const statusLabel: Record<typeof status, string> = {
    idle: '',
    uploading: 'UPLOADING METADATA...',
    building: 'BUILDING TRANSACTIONS...',
    signing: 'WAITING FOR WALLET...',
    sending: 'SUBMITTING TO SOLANA...',
    done: 'LAUNCH COMPLETE!',
  };

  return (
    <Card isMobile={isMobile}>
      <div style={s.stepTitle}>STEP 4 · REVIEW &amp; LAUNCH</div>

      {/* Summary table */}
      <div style={s.reviewTable}>
        <ReviewRow label="TOKEN NAME" value={form.tokenName || '—'} isMobile={isMobile} />
        <ReviewRow label="SYMBOL" value={form.tokenSymbol || '—'} isMobile={isMobile} />
        <ReviewRow label="DECIMALS" value={String(form.decimals)} isMobile={isMobile} />
        <ReviewRow label="TOTAL SUPPLY" value={fmtNumber(form.supply)} isMobile={isMobile} />
        <ReviewRow
          label="SOLD ON CURVE"
          value={`${fmtNumber(sellA)} (${form.curvePercent.toFixed(2)}%)`}
          isMobile={isMobile}
        />
        <ReviewRow
          label="FUNDRAISE TARGET"
          value={`${form.targetSol} SOL`}
          isMobile={isMobile}
        />
        <ReviewRow
          label="VESTING"
          value={
            form.vestingEnabled
              ? `${fmtNumber(vestA)} (${form.vestingPercent}%)`
              : 'NONE'
          }
          isMobile={isMobile}
        />
        {form.vestingEnabled && (
          <>
            <ReviewRow
              label="CLIFF"
              value={`${form.cliffDays} DAYS`}
              isMobile={isMobile}
            />
            <ReviewRow
              label="UNLOCK PERIOD"
              value={`${form.unlockDays} DAYS`}
              isMobile={isMobile}
            />
          </>
        )}
        <ReviewRow
          label="TOKEN-2022"
          value={form.token2022 ? 'YES' : 'NO'}
          isMobile={isMobile}
        />
        {form.token2022 && form.transferFeeBps > 0 && (
          <ReviewRow
            label="TRANSFER FEE"
            value={`${(form.transferFeeBps / 100).toFixed(1)}%`}
            isMobile={isMobile}
          />
        )}
        <ReviewRow
          label="INITIAL BUY"
          value={form.initialBuyEnabled ? `${form.initialBuySol} SOL` : 'NONE'}
          isMobile={isMobile}
        />
        <ReviewRow
          label="CREATOR FEES"
          value={
            form.creatorFeeOn === CpmmCreatorFeeOn.OnlyTokenB
              ? 'SOL ONLY'
              : 'BOTH TOKENS'
          }
          isMobile={isMobile}
        />
      </div>

      {/* Cost breakdown */}
      <div style={s.costCard}>
        <div style={s.costTitle}>ESTIMATED COSTS</div>
        <div style={s.costRows}>
          <CostRow
            label="BASEDFARMS LAUNCH FEE"
            value={`${(LAUNCH_FEE_LAMPORTS / LAMPORTS_PER_SOL).toFixed(2)} SOL`}
          />
          <CostRow label="NETWORK FEES" value={`≈ ${networkFeeEstimate} SOL`} />
          {form.initialBuyEnabled && form.initialBuySol > 0 && (
            <CostRow label="INITIAL BUY" value={`${form.initialBuySol} SOL`} />
          )}
          <div style={s.costDivider} />
          <CostRow label="TOTAL" value={`≈ ${totalSol.toFixed(3)} SOL`} bold />
        </div>
        <div style={s.shareNote}>
          + 0.3% of all bonding-curve trades routed to BASEDFARMS
        </div>
      </div>

      {/* Status */}
      {busy && (
        <div style={s.statusBox}>
          <span style={s.spinner}>◌</span>
          <span style={s.statusText}>{statusLabel[status]}</span>
        </div>
      )}
      {error && (
        <div style={s.errorBox}>
          <span style={s.errorTitle}>ERROR</span>
          <span style={s.errorMsg}>{error}</span>
        </div>
      )}

      {/* Success */}
      {status === 'done' && txIds.length > 0 && (
        <div style={s.successBox}>
          <div style={s.successTitle}>🚀 TOKEN LAUNCHED!</div>
          <div style={s.txList}>
            {txIds.map((sig, i) => (
              <a
                key={sig}
                href={`https://solscan.io/tx/${sig}`}
                target="_blank"
                rel="noopener noreferrer"
                style={s.txLink}
              >
                TX {i + 1} ↗ {sig.slice(0, 12)}...{sig.slice(-6)}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      {status !== 'done' &&
        (!publicKey ? (
          <button
            style={{ ...s.launchBtn, minHeight: isMobile ? '56px' : '48px' }}
            onClick={() => setVisible(true)}
          >
            CONNECT WALLET TO LAUNCH
          </button>
        ) : !signAllTransactions ? (
          <div style={s.errorBox}>
            <span style={s.errorMsg}>
              Your wallet does not support signAllTransactions. Please use Phantom or
              Backpack.
            </span>
          </div>
        ) : (
          <button
            style={{
              ...s.launchBtn,
              minHeight: isMobile ? '56px' : '48px',
              ...(busy ? s.launchBtnDisabled : {}),
            }}
            onClick={onLaunch}
            disabled={busy}
          >
            {busy ? statusLabel[status] : '🚀 LAUNCH TOKEN'}
          </button>
        ))}

      {status === 'done' && (
        <Link href="/" style={s.doneBtn}>
          ← BACK TO HOME
        </Link>
      )}
    </Card>
  );
}

function ReviewRow({
  label,
  value,
  isMobile,
}: {
  label: string;
  value: string;
  isMobile: boolean;
}) {
  return (
    <div style={s.reviewRow}>
      <span style={s.reviewLabel}>{label}</span>
      <span
        style={{
          ...s.reviewValue,
          // On mobile: truncate long values with ellipsis
          maxWidth: isMobile ? '140px' : '60%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function CostRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div style={s.costRow}>
      <span style={{ ...s.costLabel, ...(bold ? { color: '#e879f9' } : {}) }}>
        {label}
      </span>
      <span
        style={{
          ...s.costValue,
          ...(bold ? { color: '#e879f9', fontSize: '10px' } : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Progress Bar ─────────────────────────────────────────────────────────── */

function ProgressBar({ step, total, isMobile }: { step: number; total: number; isMobile: boolean }) {
  return (
    <div style={{ ...s.progressBar, padding: isMobile ? '14px 16px 6px' : '20px 20px 8px' }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={s.progressStep}>
          <div
            style={{
              ...s.progressDot,
              width: isMobile ? '22px' : '28px',
              height: isMobile ? '22px' : '28px',
              fontSize: isMobile ? '6px' : '7px',
              background:
                i < step ? '#db2777' : i === step - 1 ? '#db2777' : '#1e0035',
              borderColor:
                i === step - 1
                  ? '#db2777'
                  : i < step
                  ? '#db2777'
                  : '#3b0764',
              boxShadow:
                i === step - 1 ? '0 0 10px rgba(219, 39, 119, 0.8)' : 'none',
            }}
          >
            {i < step ? '✓' : i + 1}
          </div>
          {i < total - 1 && (
            <div
              style={{
                ...s.progressLine,
                width: isMobile ? '20px' : '40px',
                background: i < step - 1 ? '#db2777' : '#1e0035',
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────────── */

const STEPS = ['TOKEN BASICS', 'SUPPLY & CURVE', 'ADVANCED', 'REVIEW'];

export default function LaunchPage() {
  const isMobile = useMobile();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(DEFAULT);
  const [touched, setTouched] = useState<Set<ScoreTouchedKey>>(new Set());
  const [status, setStatus] = useState<
    'idle' | 'uploading' | 'building' | 'signing' | 'sending' | 'done'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [txIds, setTxIds] = useState<string[]>([]);
  const [scoreExpanded, setScoreExpanded] = useState(false);

  const markTouched = useCallback((key: ScoreTouchedKey) => {
    setTouched((prev) => {
      if (prev.has(key)) return prev; // avoid re-render if already set
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const { publicKey, signAllTransactions } = useWallet();

  const canNext = (() => {
    if (step === 1)
      return (
        form.tokenName.trim().length > 0 && form.tokenSymbol.trim().length > 0
      );
    if (step === 2)
      return form.supply > 0 && form.curvePercent >= 20 && form.targetSol > 0;
    return true;
  })();

  const handleLaunch = useCallback(async () => {
    if (!publicKey || !signAllTransactions) return;
    setError(null);

    try {
      setStatus('uploading');
      const metadataUri = await uploadMetadata({
        name: form.tokenName,
        symbol: form.tokenSymbol,
        description: form.description,
        imageDataUri: form.imageDataUri,
      });

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

      setStatus('signing');
      const typedSignAll = signAllTransactions as (
        txs: Transaction[],
      ) => Promise<Transaction[]>;

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

  // Suppress unused-effect warning — placeholder for future redirect
  useEffect(() => {}, [txIds]);

  const scorePanel = (
    <BasedScorePanel
      form={form}
      touched={touched}
      isMobile={isMobile}
      expanded={scoreExpanded}
      onToggle={() => setScoreExpanded((v) => !v)}
    />
  );

  // Nav row — stacked on mobile (NEXT on top), inline on desktop
  const navRow = step < 4 && (
    <div
      style={{
        ...s.navRow,
        flexDirection: isMobile ? 'column-reverse' : 'row',
        gap: isMobile ? '8px' : '12px',
      }}
    >
      {step > 1 && (
        <button
          style={{
            ...s.backBtn,
            minHeight: isMobile ? '48px' : 'auto',
            flex: isMobile ? 'none' : 1,
            width: isMobile ? '100%' : 'auto',
          }}
          onClick={() => setStep((prev) => prev - 1)}
        >
          ← BACK
        </button>
      )}
      <button
        style={{
          ...s.nextBtn,
          minHeight: isMobile ? '48px' : 'auto',
          flex: isMobile ? 'none' : 2,
          width: isMobile ? '100%' : 'auto',
          ...(canNext ? {} : s.nextBtnDisabled),
        }}
        onClick={() => {
          if (canNext) setStep((prev) => prev + 1);
        }}
        disabled={!canNext}
      >
        {step === 3 ? 'REVIEW →' : 'NEXT →'}
      </button>
    </div>
  );

  return (
    <main style={s.page}>
      {/* Header */}
      <header style={s.header}>
        <Link href="/" style={s.logo}>
          BASED<span style={s.logoAccent}>FARMS</span>
        </Link>
        <span style={s.headerLabel}>LAUNCH TOKEN</span>
      </header>

      {/* Progress */}
      <ProgressBar step={step} total={STEPS.length} isMobile={isMobile} />

      {isMobile ? (
        /* ── Mobile layout: single column, score above form ── */
        <div style={s.mobileLayout}>
          {scorePanel}
          {step === 1 && <Step1 form={form} setForm={setForm} isMobile={isMobile} onTouch={markTouched} />}
          {step === 2 && <Step2 form={form} setForm={setForm} isMobile={isMobile} onTouch={markTouched} />}
          {step === 3 && <Step3 form={form} setForm={setForm} isMobile={isMobile} onTouch={markTouched} />}
          {step === 4 && (
            <Step4
              form={form}
              status={status}
              error={error}
              txIds={txIds}
              onLaunch={handleLaunch}
              isMobile={isMobile}
            />
          )}
          {navRow}
        </div>
      ) : (
        /* ── Desktop layout: two-column ── */
        <div style={s.layout}>
          <div style={s.formCol}>
            {step === 1 && <Step1 form={form} setForm={setForm} isMobile={false} onTouch={markTouched} />}
            {step === 2 && <Step2 form={form} setForm={setForm} isMobile={false} onTouch={markTouched} />}
            {step === 3 && <Step3 form={form} setForm={setForm} isMobile={false} onTouch={markTouched} />}
            {step === 4 && (
              <Step4
                form={form}
                status={status}
                error={error}
                txIds={txIds}
                onLaunch={handleLaunch}
                isMobile={false}
              />
            )}
            {navRow}
          </div>
          <div style={s.scoreCol}>{scorePanel}</div>
        </div>
      )}

      <div style={s.footer}>
        POWERED BY RAYDIUM LAUNCHLAB · BASED FARMS · 0.1 SOL LAUNCH FEE
      </div>
    </main>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const s: Record<string, React.CSSProperties> = {
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
    padding: '14px 16px',
    borderBottom: '1px solid #1e0035',
    background: 'rgba(13, 0, 21, 0.95)',
    backdropFilter: 'blur(10px)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  logo: {
    fontFamily: font,
    fontSize: '11px',
    letterSpacing: '2px',
    color: '#c084fc',
    textDecoration: 'none',
    textShadow: '0 0 10px rgba(192, 132, 252, 0.4)',
  },
  logoAccent: { color: '#db2777' },
  headerLabel: {
    fontFamily: font,
    fontSize: '7px',
    color: '#e879f9',
    letterSpacing: '2px',
    textShadow: '0 0 8px rgba(232, 121, 249, 0.5)',
  },
  progressBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  progressStep: {
    display: 'flex',
    alignItems: 'center',
  },
  progressDot: {
    borderRadius: '50%',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: font,
    color: '#ffffff',
    flexShrink: 0,
    transition: 'all 0.2s ease',
    cursor: 'default',
  },
  progressLine: {
    height: '2px',
    transition: 'background 0.2s ease',
  },
  // Desktop: two-column
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
    top: '72px',
  },
  // Mobile: single column
  mobileLayout: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '12px 12px 0',
    boxSizing: 'border-box',
  },
  // Cards
  card: {
    background: 'rgba(13, 0, 32, 0.9)',
    border: '1px solid #3b0764',
    boxShadow:
      '0 0 30px rgba(124, 58, 237, 0.12), inset 0 0 20px rgba(88, 28, 135, 0.04)',
    animation: 'border-glow 4s ease-in-out infinite',
  },
  stepTitle: {
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '2px',
    color: '#e879f9',
    textShadow: '0 0 8px rgba(232, 121, 249, 0.5)',
    marginBottom: '20px',
    paddingBottom: '12px',
    borderBottom: '1px solid #1e0035',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '16px',
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
    lineHeight: 1.6,
  },
  input: {
    background: '#0d0020',
    border: '1px solid #3b0764',
    borderRadius: '8px',
    padding: '11px 12px',
    color: '#c084fc',
    fontFamily: font,
    fontSize: '8px',
    letterSpacing: '1px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
    minHeight: '44px', // touch target
  },
  inputDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  textarea: {
    background: '#0d0020',
    border: '1px solid #3b0764',
    borderRadius: '8px',
    padding: '11px 12px',
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
    padding: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    minHeight: '110px',
    transition: 'border-color 0.2s',
    background: 'rgba(13, 0, 32, 0.5)',
  },
  imageUploadInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  imageUploadIcon: { fontSize: '28px', color: '#3b0764' },
  imageUploadText: {
    fontFamily: font,
    fontSize: '7px',
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
    width: '88px',
    height: '88px',
    borderRadius: '10px',
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
    padding: '4px 0',
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
    padding: '10px 14px',
    color: '#6d28d9',
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    minHeight: '40px',
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
    gap: '10px',
  },
  slider: {
    flex: 1,
    accentColor: '#db2777',
    cursor: 'pointer',
    minHeight: '24px', // touch target
  },
  sliderValue: {
    fontFamily: font,
    fontSize: '8px',
    color: '#db2777',
    minWidth: '52px',
    textAlign: 'right',
    textShadow: '0 0 8px rgba(219, 39, 119, 0.5)',
    flexShrink: 0,
  },
  curveStats: {
    display: 'flex',
    gap: '10px',
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
    paddingBottom: '14px',
    marginBottom: '14px',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    userSelect: 'none',
    minHeight: '44px', // touch target
  },
  toggleTrack: {
    width: '44px',
    height: '24px',
    borderRadius: '12px',
    position: 'relative',
    transition: 'background 0.2s',
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
    lineHeight: 1.5,
  },
  toggleLabel2: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1.5px',
    color: '#7c3aed',
    marginBottom: '10px',
  },
  toggleContent: {},
  twoCol: {
    display: 'grid',
    gap: '10px',
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
    gap: '8px',
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
    flexShrink: 0,
  },
  // Review
  reviewTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    marginBottom: '16px',
    border: '1px solid #1e0035',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  reviewRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '9px 12px',
    borderBottom: '1px solid #0d0020',
    gap: '10px',
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
  },
  costCard: {
    background: 'rgba(88, 28, 135, 0.08)',
    border: '1px solid #3b0764',
    borderRadius: '10px',
    padding: '14px',
    marginBottom: '16px',
  },
  costTitle: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    color: '#7c3aed',
    marginBottom: '10px',
  },
  costRows: { display: 'flex', flexDirection: 'column', gap: '8px' },
  costRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  costLabel: {
    fontFamily: font,
    fontSize: '6px',
    color: '#6d28d9',
    letterSpacing: '1px',
  },
  costValue: { fontFamily: font, fontSize: '7px', color: '#c084fc' },
  costDivider: { height: '1px', background: '#1e0035', margin: '2px 0' },
  shareNote: {
    fontFamily: font,
    fontSize: '6px',
    color: '#3b0764',
    letterSpacing: '1px',
    marginTop: '8px',
    textAlign: 'center',
  },
  statusBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    background: 'rgba(124, 58, 237, 0.1)',
    border: '1px solid #7c3aed',
    borderRadius: '8px',
    marginBottom: '14px',
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
    padding: '12px',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    marginBottom: '14px',
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
    gap: '10px',
    padding: '14px',
    background: 'rgba(34, 197, 94, 0.08)',
    border: '1px solid #22c55e',
    borderRadius: '8px',
    marginBottom: '14px',
  },
  successTitle: {
    fontFamily: font,
    fontSize: '9px',
    color: '#22c55e',
    letterSpacing: '2px',
    textShadow: '0 0 10px rgba(34, 197, 94, 0.5)',
  },
  txList: { display: 'flex', flexDirection: 'column', gap: '8px' },
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
    transition: 'opacity 0.2s',
  },
  launchBtnDisabled: { opacity: 0.55, cursor: 'not-allowed', boxShadow: 'none' },
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
  navRow: {
    display: 'flex',
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
  nextBtnDisabled: { opacity: 0.4, cursor: 'not-allowed', boxShadow: 'none' },
  // Desktop score panel
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
    textShadow: '0 0 8px rgba(232, 121, 249, 0.4)',
    textAlign: 'center',
  },
  scoreCircle: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: '4px',
    margin: '12px 0 10px',
  },
  scoreNumber: {
    fontFamily: font,
    fontSize: '36px',
    lineHeight: 1,
    textShadow: '0 0 20px currentColor',
    transition: 'color 0.3s',
  },
  scoreMax: { fontFamily: font, fontSize: '10px', color: '#3b0764' },
  scoreBarTrack: {
    height: '4px',
    background: '#1e0035',
    borderRadius: '2px',
    overflow: 'hidden',
    margin: '8px 0',
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
    marginBottom: '14px',
  },
  scoreItems: { display: 'flex', flexDirection: 'column', gap: '7px' },
  scoreItem: { display: 'flex', alignItems: 'flex-start', gap: '7px' },
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
  // Mobile score panel
  scorePanelMobile: {
    background: 'rgba(13, 0, 32, 0.95)',
    border: '1px solid #3b0764',
    borderRadius: '10px',
    padding: '12px 14px',
    boxShadow: '0 0 16px rgba(124, 58, 237, 0.1)',
  },
  scoreMobileHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    userSelect: 'none',
    marginBottom: '8px',
    minHeight: '36px',
  },
  scoreMobileSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  scoreMobileNumber: {
    fontFamily: font,
    fontSize: '18px',
    lineHeight: 1,
    textShadow: '0 0 10px currentColor',
    transition: 'color 0.3s',
  },
  scoreMobileTier: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '1px',
    transition: 'color 0.3s',
  },
  scoreExpandIcon: {
    fontFamily: font,
    fontSize: '8px',
    color: '#3b0764',
    marginLeft: '2px',
  },
  scoreMobileBreakdown: {
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: '1px solid #1e0035',
  },
  scoreCategory: {
    fontFamily: font,
    fontSize: '5px',
    letterSpacing: '2px',
    color: '#4c1d95',
    marginTop: '10px',
    marginBottom: '5px',
    textTransform: 'uppercase' as const,
  },
  basedBonusRow: {
    marginTop: '4px',
    padding: '5px 7px',
    background: 'rgba(245, 158, 11, 0.07)',
    borderRadius: '5px',
    border: '1px solid rgba(245, 158, 11, 0.2)',
  },
  basedBonusBadge: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '1px',
    color: '#f59e0b',
    textShadow: '0 0 10px rgba(245, 158, 11, 0.6)',
    textAlign: 'center' as const,
    margin: '6px 0 4px',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  scoreDivider: {
    height: '1px',
    background: 'linear-gradient(90deg, transparent, #3b0764, transparent)',
    margin: '14px 0',
  },
  // Based Points section
  basedPointsPanel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  basedPointsTitle: {
    fontFamily: font,
    fontSize: '7px',
    letterSpacing: '2px',
    color: '#f59e0b',
    textShadow: '0 0 8px rgba(245, 158, 11, 0.4)',
    marginBottom: '4px',
  },
  basedPointsRows: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '5px',
  },
  basedPointsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
  },
  basedPointsIcon: {
    fontFamily: font,
    fontSize: '8px',
    color: '#78350f',
    flexShrink: 0,
  },
  basedPointsEvent: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '0.5px',
    color: '#92400e',
    flex: 1,
  },
  basedPointsValue: {
    fontFamily: font,
    fontSize: '7px',
    color: '#f59e0b',
    letterSpacing: '1px',
    flexShrink: 0,
  },
  basedPointsHint: {
    fontFamily: font,
    fontSize: '5px',
    letterSpacing: '0.3px',
    color: '#78350f',
    lineHeight: 1.6,
    fontStyle: 'italic' as const,
  },
  // Footer
  footer: {
    fontFamily: font,
    fontSize: '6px',
    letterSpacing: '1.5px',
    color: '#1e0035',
    textAlign: 'center',
    marginTop: '40px',
    padding: '0 16px',
  },
};
