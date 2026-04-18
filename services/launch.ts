/**
 * Token launch service — Raydium LaunchLab (letsbonk.fun protocol)
 *
 * Creates a new SPL token and initialises a LaunchLab bonding-curve pool in
 * a single multi-transaction flow signed by the user's wallet adapter.
 */
import {
  Raydium,
  TxVersion,
  LAUNCHPAD_PROGRAM,
  DEVNET_PROGRAM_ID,
  getPdaLaunchpadConfigId,
  getPdaLaunchpadPoolId,
  LaunchpadConfig,
  CpmmCreatorFeeOn,
} from '@raydium-io/raydium-sdk-v2';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';

/* ── Constants ────────────────────────────────────────────────────────────── */

/**
 * BASEDFARMS treasury — receives the 0.1 SOL launch fee and 0.3% trade share.
 * Reads from NEXT_PUBLIC_TREASURY_WALLET env var; falls back to hardcoded address.
 * Lazy getter so PublicKey is never constructed during SSR module initialisation.
 */
const TREASURY_ADDRESS =
  process.env.NEXT_PUBLIC_TREASURY_WALLET ??
  '6MB3syAmv6rmVavKxZveDdPYrmmwGcwoM2BfkDbfkQd8';

function getTreasury(): PublicKey {
  return new PublicKey(TREASURY_ADDRESS);
}

/** 0.3% of bonding-curve trading volume routed to BASEDFARMS */
const SHARE_FEE_RATE = new BN(30); // 30 bps

/** Fixed BASEDFARMS launch fee in lamports (0.1 SOL) */
export const LAUNCH_FEE_LAMPORTS = Math.round(0.1 * LAMPORTS_PER_SOL);

/** True when NEXT_PUBLIC_LAUNCH_NETWORK=devnet is set in env */
export const IS_DEVNET = process.env.NEXT_PUBLIC_LAUNCH_NETWORK === 'devnet';

/** Program ID — devnet or mainnet depending on IS_DEVNET */
export const LAUNCH_PROGRAM_ID = IS_DEVNET
  ? DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM
  : LAUNCHPAD_PROGRAM;

/** RPC endpoint — devnet or env-configured mainnet */
export const LAUNCH_RPC: string = IS_DEVNET
  ? 'https://api.devnet.solana.com'
  : (process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.mainnet-beta.solana.com');

/** Raydium constant-product config for SOL pools (index 0, curveType 0) */
const CURVE_TYPE = 0;
const CONFIG_INDEX = 0;

/**
 * Known valid PlatformConfig account on devnet.
 * The SDK always requires a registered platform account — it has no fallback.
 * This is a real devnet platform (out of 677+ that exist) with feeRate=1000.
 */
const DEVNET_PLATFORM_ID = new PublicKey('9abQu8Q1zuJ8AP5yZUUQ2gMm9eMqr45cdf23PPT3NxAz');

/**
 * BASEDFARMS platform ID.
 * Devnet: hardcoded known-good devnet platform account.
 * Mainnet: reads NEXT_PUBLIC_PLATFORM_ID (registered via /admin/platform).
 */
function getPlatformId(): PublicKey | undefined {
  if (IS_DEVNET) return DEVNET_PLATFORM_ID;
  const id = process.env.NEXT_PUBLIC_PLATFORM_ID;
  if (!id) return undefined;
  try { return new PublicKey(id); } catch { return undefined; }
}

/* ── RPC ──────────────────────────────────────────────────────────────────── */

function getConn(): Connection {
  return new Connection(LAUNCH_RPC, 'confirmed');
}

async function loadRaydium(owner: PublicKey): Promise<Raydium> {
  const connection = getConn();
  // Proxy rewrites only make sense on mainnet; devnet calls the API directly
  const urlConfigs =
    !IS_DEVNET && typeof window !== 'undefined'
      ? { BASE_HOST: '/api/raydium-v3', SWAP_HOST: '/api/raydium' }
      : {};
  return Raydium.load({
    connection,
    owner,
    cluster: IS_DEVNET ? 'devnet' : 'mainnet',
    disableLoadToken: true,
    disableFeatureCheck: true,
    blockhashCommitment: 'confirmed',
    urlConfigs,
  });
}

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface LaunchParams {
  // Step 1 — Token basics
  name: string;
  symbol: string;
  description: string;
  /** base64 data URI for the token image, or empty string */
  imageDataUri: string;
  decimals: 6;

  // Step 2 — Supply & curve
  /** Total token supply (in whole tokens, e.g. 1_000_000_000) */
  supply: number;
  /** Percentage of supply sold on the bonding curve (20–100) */
  curvePercent: number;
  /** SOL fundraising target before graduating to CPMM (e.g. 85) */
  targetSol: number;

  // Step 3 — Advanced
  token2022: boolean;
  /** Transfer fee in basis points (0–1000). Only used when token2022 = true */
  transferFeeBps: number;
  /** Max transfer fee in token's raw units. Only used when token2022 = true */
  maxTransferFeeRaw: bigint;
  vestingEnabled: boolean;
  /** % of total supply reserved for vesting (0–30). Only used when vestingEnabled = true */
  vestingPercent: number;
  /** Cliff period in seconds (0 = no cliff). Only used when vestingEnabled = true */
  cliffSeconds: number;
  /** Unlock / vesting period in seconds. Only used when vestingEnabled = true */
  unlockSeconds: number;
  /** SOL to spend on an initial buy at launch (0 = no initial buy) */
  initialBuyLamports: number;
  creatorFeeOn: CpmmCreatorFeeOn;
}

export interface LaunchResult {
  /** Signatures of all submitted transactions, in order */
  txIds: string[];
  /** Public key of the new token mint */
  mintAddress: string;
  /** Public key of the new launchpad pool */
  poolId: string;
}

/* ── Metadata upload ──────────────────────────────────────────────────────── */

/**
 * POSTs the token metadata to /api/metadata and returns the hosted URI.
 * This must be called before createToken so the URI is available for the tx.
 */
export async function uploadMetadata(params: {
  name: string;
  symbol: string;
  description: string;
  imageDataUri: string;
}): Promise<string> {
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000');

  const res = await fetch(`${origin}/api/metadata`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      symbol: params.symbol,
      description: params.description,
      image: params.imageDataUri,
    }),
  });

  if (!res.ok) throw new Error(`Metadata upload failed: ${res.statusText}`);
  const { url } = (await res.json()) as { id: string; url: string };
  return url;
}

/* ── Main service ─────────────────────────────────────────────────────────── */

/**
 * Creates a new token and initialises a Raydium LaunchLab bonding-curve pool.
 *
 * @param params         Launch configuration from the multi-step form.
 * @param metadataUri    Hosted URI pointing to the token's metadata JSON.
 * @param userPublicKey  Connected wallet public key.
 * @param signAllTransactions  Wallet adapter's signAllTransactions function.
 */
export async function createToken(
  params: LaunchParams,
  metadataUri: string,
  userPublicKey: PublicKey,
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>,
): Promise<LaunchResult> {
  console.log('[Launch] createToken start', {
    name: params.name,
    symbol: params.symbol,
    supply: params.supply,
    curvePercent: params.curvePercent,
    targetSol: params.targetSol,
  });

  const connection = getConn();
  const raydium = await loadRaydium(userPublicKey);

  // ── Derive config PDA ──────────────────────────────────────────────────────
  const configId = getPdaLaunchpadConfigId(
    LAUNCH_PROGRAM_ID,
    NATIVE_MINT,
    CURVE_TYPE,
    CONFIG_INDEX,
  ).publicKey;
  console.log('[Launch] configId:', configId.toBase58());

  // Fetch on-chain config for validation (optional but helpful)
  let configInfo: ReturnType<typeof LaunchpadConfig.decode> | undefined;
  try {
    const configAcct = await connection.getAccountInfo(configId, 'processed');
    if (configAcct) configInfo = LaunchpadConfig.decode(configAcct.data);
    console.log('[Launch] configInfo fetched, epoch:', configInfo?.epoch.toString());
  } catch (err) {
    console.warn('[Launch] could not fetch configInfo — SDK will fetch it:', err);
  }

  // ── Generate fresh mint keypair ────────────────────────────────────────────
  const mintKeypair = Keypair.generate();
  console.log('[Launch] mintA:', mintKeypair.publicKey.toBase58());

  // ── Compute curve parameters (raw BN values) ───────────────────────────────
  const supplyRaw = new BN(params.supply).mul(new BN(10 ** 6));

  // totalSellA = curvePercent% of supply (tokens available on the bonding curve)
  const totalSellA = supplyRaw
    .mul(new BN(Math.floor(params.curvePercent * 100)))
    .div(new BN(10000));

  // migrateAmount = tokens reserved for the AMM pool at graduation
  const migrateAmount = supplyRaw.sub(totalSellA);

  // Validate: at least 20% of supply must remain for the AMM pool
  const minMigrate = supplyRaw.mul(new BN(20)).div(new BN(100));
  if (migrateAmount.lt(minMigrate)) {
    throw new Error('At least 20% of supply must be reserved for the Raydium AMM pool');
  }

  // totalLockedAmount = tokens reserved for vesting (0 if disabled)
  const vestPercent = params.vestingEnabled ? Math.min(30, Math.max(0, params.vestingPercent)) : 0;
  const totalLockedAmount = supplyRaw
    .mul(new BN(Math.round(vestPercent * 100)))
    .div(new BN(10000));
  const totalFundRaisingB = new BN(Math.round(params.targetSol * LAMPORTS_PER_SOL));

  console.log('[Launch] supply:', supplyRaw.toString());
  console.log('[Launch] totalSellA:', totalSellA.toString());
  console.log('[Launch] migrateAmount:', migrateAmount.toString());
  console.log('[Launch] totalLockedAmount:', totalLockedAmount.toString());
  console.log('[Launch] totalFundRaisingB:', totalFundRaisingB.toString());

  // ── Initial buy ────────────────────────────────────────────────────────────
  const buyAmount = new BN(params.initialBuyLamports);
  // minMintAAmount = 0 for initial buy at launch (first purchaser, price is lowest)
  const minMintAAmount = new BN(0);

  // ── Build the launchpad transaction(s) ────────────────────────────────────
  console.log('[Launch] IS_DEVNET:', IS_DEVNET);
  console.log('[Launch] calling raydium.launchpad.createLaunchpad...');

  // Build config as a mutable object so platformId is physically absent on devnet.
  // The mainnet platform ID (32SyS4S…) does not exist on devnet — passing it
  // causes a "platform id not found" error, so we never include it when IS_DEVNET.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const launchConfig: Record<string, any> = {
    programId: LAUNCH_PROGRAM_ID,
    mintA: mintKeypair.publicKey,
    name: params.name,
    symbol: params.symbol,
    uri: metadataUri,
    decimals: 6,
    configId,
    configInfo,
    migrateType: 'cpmm',
    supply: supplyRaw,
    totalSellA,
    totalFundRaisingB,
    totalLockedAmount,
    cliffPeriod: params.vestingEnabled ? new BN(params.cliffSeconds) : new BN(0),
    unlockPeriod: params.vestingEnabled ? new BN(params.unlockSeconds) : new BN(0),
    buyAmount,
    minMintAAmount,
    token2022: params.token2022,
    transferFeeExtensionParams: params.token2022 && params.transferFeeBps > 0
      ? {
          transferFeeBasePoints: params.transferFeeBps,
          maxinumFee: new BN(params.maxTransferFeeRaw.toString()),
        }
      : undefined,
    creatorFeeOn: params.creatorFeeOn,
    shareFeeRate: SHARE_FEE_RATE,
    shareFeeReceiver: getTreasury(),
    extraSigners: [mintKeypair],
    txVersion: TxVersion.LEGACY,
    computeBudgetConfig: { units: 800_000, microLamports: 150_000 },
  };

  const pid = getPlatformId();
  if (pid) {
    launchConfig.platformId = pid;
    console.log('[Launch] using platformId:', pid.toBase58(), IS_DEVNET ? '(devnet hardcoded)' : '(mainnet)');
  } else {
    // Only happens on mainnet when NEXT_PUBLIC_PLATFORM_ID is not configured
    console.warn('[Launch] NEXT_PUBLIC_PLATFORM_ID not set — SDK will use its own default (may fail)');
  }

  console.log('[Launch] launchConfig keys:', Object.keys(launchConfig));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await raydium.launchpad.createLaunchpad(launchConfig as any) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { transactions, signers, extInfo } = result as {
    transactions: Transaction[];
    signers: Keypair[][];
    extInfo: { address: { poolId: { toBase58(): string } } };
  };
  const poolId = extInfo.address.poolId.toBase58();
  const mintAddress = mintKeypair.publicKey.toBase58();

  console.log('[Launch] got', transactions.length, 'txs | poolId:', poolId);

  // ── Inject BASEDFARMS 0.1 SOL fee into the first transaction ──────────────
  const feeInstruction = SystemProgram.transfer({
    fromPubkey: userPublicKey,
    toPubkey: getTreasury(),
    lamports: LAUNCH_FEE_LAMPORTS,
  });
  transactions[0].add(feeInstruction);

  // ── Set fresh blockhash and pre-sign each tx with SDK-managed signers ──────
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    tx.recentBlockhash = blockhash;
    tx.feePayer = userPublicKey;
    const txSigners = signers[i] ?? [];
    if (txSigners.length > 0) {
      console.log('[Launch] pre-signing tx', i, 'with', txSigners.length, 'SDK signers');
      tx.sign(...txSigners);
    }
  }

  // ── User signs all transactions at once ────────────────────────────────────
  console.log('[Launch] requesting wallet to sign', transactions.length, 'transactions...');
  const signedTxs = await signAllTransactions(transactions);

  // ── Submit and confirm each transaction sequentially ──────────────────────
  const txIds: string[] = [];
  for (let i = 0; i < signedTxs.length; i++) {
    const tx = signedTxs[i];
    console.log('[Launch] sending tx', i + 1, '/', signedTxs.length, '...');
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    console.log('[Launch] tx', i + 1, 'sent:', sig);
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    console.log('[Launch] tx', i + 1, 'confirmed');
    txIds.push(sig);
  }

  console.log('[Launch] all done!', { txIds, mintAddress, poolId });
  return { txIds, mintAddress, poolId };
}

/* ── Based Score calculator ───────────────────────────────────────────────── */

export interface BasedScoreBreakdown {
  /** Displayed score, capped at 100 */
  total: number;
  /** Raw score before cap — may exceed 100 when based bonus applies */
  rawTotal: number;
  /** True when at least one of name/symbol contains "based" (case-insensitive) */
  hasBasedBonus: boolean;
  /** Actual based bonus points earned: 0, 10, or 25 */
  basedBonusPts: number;
  items: {
    label: string;
    pts: number;
    earned: boolean;
    /** Grouping header shown in the score panel */
    category: string;
    /** True for based-bonus rows — rendered with gold accent */
    bonus?: boolean;
  }[];
}

/**
 * Keys that must appear in `touched` before their criterion can be earned.
 * name / symbol / image infer "touched" from the value itself.
 */
export type ScoreTouchedKey =
  | 'vestingEnabled'
  | 'supply'
  | 'curvePercent'
  | 'targetSol'
  | 'creatorFeeOn';

export function calcBasedScore(
  params: Partial<LaunchParams> & { imageDataUri?: string },
  touched: Set<ScoreTouchedKey> = new Set(),
): BasedScoreBreakdown {
  const t = (key: ScoreTouchedKey) => touched.has(key);

  /* ── BASICS (30 pts) — value presence is the touch signal ── */
  const hasName   = (params.name?.trim().length ?? 0) > 0;
  const hasSymbol = (params.symbol?.trim().length ?? 0) > 0;
  const hasImage  = !!(params.imageDataUri);

  /* ── BASED BONUS (up to +25 extra) ── */
  const nameHasBased   = /based/i.test(params.name ?? '');
  const symbolHasBased = /based/i.test(params.symbol ?? '');
  const bothBased      = nameHasBased && symbolHasBased;
  const eitherBased    = nameHasBased || symbolHasBased;
  const basedBonusPts  = bothBased ? 25 : eitherBased ? 10 : 0;

  /* ── SUPPLY (up to 10 pts) — mutually exclusive tiers ── */
  const supply = params.supply ?? 0;
  const supplyLabel =
    supply === 69_000_000     ? 'Supply = 69M (meme number)'
    : supply <= 100_000_000   ? 'Supply ≤ 100M'
    : supply <= 500_000_000   ? 'Supply ≤ 500M'
    : supply <= 1_000_000_000 ? 'Supply ≤ 1B'
    : 'Supply > 1B';
  const supplyItemPts =
    supply === 69_000_000     ? 10
    : supply <= 100_000_000   ? 8
    : supply <= 500_000_000   ? 5
    : supply <= 1_000_000_000 ? 3
    : 0;
  const supplyEarned = t('supply') && supplyItemPts > 0;

  /* ── CURVE & FUNDRAISE (up to 30 pts) ── */
  const curve = params.curvePercent ?? 0;
  // Show the best currently-applicable curve tier as a single item
  const curveItemLabel = curve >= 79 ? 'Curve ≥ 79% sold on curve' : 'Curve ≥ 65% sold on curve';
  const curveItemPts   = curve >= 79 ? 20 : 10;
  const curveEarned    = curve >= 79
    ? t('curvePercent') && curve >= 79
    : t('curvePercent') && curve >= 65;

  const sol = params.targetSol ?? 0;
  const solTargetLabel =
    sol < 10   ? 'SOL target < 10 (RED FLAG)'
    : sol < 50  ? 'SOL target 10–49 SOL'
    : sol < 100 ? 'SOL target 50–99 SOL'
    : sol <= 200 ? 'SOL target 100–200 SOL'
    : 'SOL target > 200 SOL';
  const solTargetPts =
    sol < 10   ? -10
    : sol < 50  ? 5
    : sol < 100 ? 10
    : sol <= 200 ? 8
    : 3;
  const solTargetEarned = t('targetSol');

  /* ── ADVANCED (30 pts) ── */
  const vestingEarned  = t('vestingEnabled') && !!params.vestingEnabled;
  const creatorEarned  = t('creatorFeeOn') && params.creatorFeeOn === CpmmCreatorFeeOn.OnlyTokenB;

  /* ── Build items array ── */
  const items: BasedScoreBreakdown['items'] = [
    { label: 'Token name provided',   pts: 10, earned: hasName,   category: 'BASICS' },
    { label: 'Token symbol provided', pts: 10, earned: hasSymbol, category: 'BASICS' },
    { label: 'Token image uploaded',  pts: 10, earned: hasImage,  category: 'BASICS' },
    { label: supplyLabel,    pts: supplyItemPts, earned: supplyEarned,    category: 'SUPPLY' },
    { label: curveItemLabel, pts: curveItemPts,  earned: curveEarned,    category: 'CURVE & FUNDRAISE' },
    { label: solTargetLabel, pts: solTargetPts,  earned: solTargetEarned, category: 'CURVE & FUNDRAISE' },
    { label: 'Vesting enabled',       pts: 20, earned: vestingEarned, category: 'ADVANCED' },
    { label: 'Creator fees: SOL only',pts: 10, earned: creatorEarned, category: 'ADVANCED' },
  ];

  if (eitherBased) {
    const bonusLabel = bothBased
      ? 'Name & symbol both contain "based"'
      : nameHasBased
      ? 'Name contains "based"'
      : 'Symbol contains "based"';
    items.push({ label: bonusLabel, pts: basedBonusPts, earned: true, category: 'BASED BONUS', bonus: true });
  }

  /* ── Totals ── */
  const baseScore = (hasName ? 10 : 0) + (hasSymbol ? 10 : 0) + (hasImage ? 10 : 0)
    + (supplyEarned ? supplyItemPts : 0)
    + (curveEarned ? curveItemPts : 0)
    + (solTargetEarned ? solTargetPts : 0)
    + (vestingEarned ? 20 : 0)
    + (creatorEarned ? 10 : 0);

  const rawTotal = baseScore + basedBonusPts;
  const total    = Math.min(100, rawTotal);

  return { total, rawTotal, hasBasedBonus: eitherBased, basedBonusPts, items };
}

/* ── Re-export SDK enum for consumers ────────────────────────────────────── */
export { CpmmCreatorFeeOn };
