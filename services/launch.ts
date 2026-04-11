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
 * BASEDFARMS treasury address (replace with real wallet before mainnet launch).
 * Lazy getter so it isn't evaluated during SSR module initialisation.
 */
const TREASURY_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'; // TODO: replace
function getTreasury(): PublicKey {
  return new PublicKey(TREASURY_ADDRESS);
}

/** 0.3% of bonding-curve trading volume routed to BASEDFARMS */
const SHARE_FEE_RATE = new BN(30); // 30 bps

/** Fixed BASEDFARMS launch fee in lamports (0.1 SOL) */
export const LAUNCH_FEE_LAMPORTS = Math.round(0.1 * LAMPORTS_PER_SOL);

/** Raydium constant-product config for SOL pools (index 0, curveType 0) */
const CURVE_TYPE = 0;
const CONFIG_INDEX = 0;

/* ── RPC ──────────────────────────────────────────────────────────────────── */

const RPC_URL = (() => {
  const url = process.env.NEXT_PUBLIC_RPC_URL;
  if (url && url.startsWith('https://')) return url;
  return 'https://mainnet.helius-rpc.com/?api-key=229cc849-fb9c-4ef0-968a-a0402480d121';
})();

function getConn(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

async function loadRaydium(owner: PublicKey): Promise<Raydium> {
  const connection = getConn();
  const urlConfigs =
    typeof window !== 'undefined'
      ? { BASE_HOST: '/api/raydium-v3', SWAP_HOST: '/api/raydium' }
      : {};
  return Raydium.load({
    connection,
    owner,
    cluster: 'mainnet',
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
  decimals: 6 | 9;

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
    LAUNCHPAD_PROGRAM,
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
  const supplyRaw = new BN(params.supply).mul(new BN(10).pow(new BN(params.decimals)));
  const sellPercent = Math.min(100, Math.max(20, params.curvePercent));
  // totalSellA = tokens available for purchase on the bonding curve
  const totalSellA = supplyRaw.muln(Math.round(sellPercent * 100)).divn(10_000);
  // totalLockedAmount = tokens reserved for vesting (0 if disabled)
  const vestPercent = params.vestingEnabled ? Math.min(30, Math.max(0, params.vestingPercent)) : 0;
  const totalLockedAmount = supplyRaw.muln(Math.round(vestPercent * 100)).divn(10_000);
  const totalFundRaisingB = new BN(Math.round(params.targetSol * LAMPORTS_PER_SOL));

  console.log('[Launch] curve params:', {
    supplyRaw: supplyRaw.toString(),
    totalSellA: totalSellA.toString(),
    totalLockedAmount: totalLockedAmount.toString(),
    totalFundRaisingB: totalFundRaisingB.toString(),
  });

  // ── Initial buy ────────────────────────────────────────────────────────────
  const buyAmount = new BN(params.initialBuyLamports);
  // minMintAAmount = 0 for initial buy at launch (first purchaser, price is lowest)
  const minMintAAmount = new BN(0);

  // ── Build the launchpad transaction(s) ────────────────────────────────────
  console.log('[Launch] calling raydium.launchpad.createLaunchpad...');
  const result = await raydium.launchpad.createLaunchpad({
    programId: LAUNCHPAD_PROGRAM,
    mintA: mintKeypair.publicKey,
    name: params.name,
    symbol: params.symbol,
    uri: metadataUri,
    decimals: params.decimals,
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
  });

  const { transactions, signers, extInfo } = result;
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
  total: number;
  items: { label: string; pts: number; earned: boolean }[];
}

export function calcBasedScore(params: Partial<LaunchParams> & { imageDataUri?: string }): BasedScoreBreakdown {
  const items: { label: string; pts: number; earned: boolean }[] = [
    {
      label: 'Vesting enabled',
      pts: 20,
      earned: !!params.vestingEnabled,
    },
    {
      label: 'Supply ≤ 1 billion',
      pts: 10,
      earned: (params.supply ?? 0) > 0 && (params.supply ?? 0) <= 1_000_000_000,
    },
    {
      label: 'Fair curve (≥ 79% sold on curve)',
      pts: 20,
      earned: (params.curvePercent ?? 0) >= 79,
    },
    {
      label: 'Decent curve (≥ 65% sold on curve)',
      pts: 10,
      earned: (params.curvePercent ?? 0) >= 65 && (params.curvePercent ?? 0) < 79,
    },
    {
      label: 'Solid fundraise target (≥ 50 SOL)',
      pts: 15,
      earned: (params.targetSol ?? 0) >= 50,
    },
    {
      label: 'Creator fees on SOL only',
      pts: 10,
      earned: params.creatorFeeOn === CpmmCreatorFeeOn.OnlyTokenB,
    },
    {
      label: 'Conservative initial buy (≤ 1 SOL)',
      pts: 10,
      earned: params.initialBuyLamports === 0 || (params.initialBuyLamports ?? 0) <= LAMPORTS_PER_SOL,
    },
    {
      label: 'Token image uploaded',
      pts: 5,
      earned: !!(params.imageDataUri),
    },
    {
      label: 'Description provided',
      pts: 5,
      earned: (params.description?.trim().length ?? 0) > 10,
    },
    {
      label: 'Symbol ≤ 6 characters',
      pts: 5,
      earned: (params.symbol?.length ?? 0) > 0 && (params.symbol?.length ?? 0) <= 6,
    },
  ];

  // Only show one of fair/decent curve, not both
  const fairEarned = items.find((i) => i.label.startsWith('Fair curve'))?.earned;
  if (fairEarned) {
    const decentIdx = items.findIndex((i) => i.label.startsWith('Decent'));
    if (decentIdx !== -1) items[decentIdx].earned = false;
  }

  const total = Math.min(
    100,
    items.reduce((sum, i) => sum + (i.earned ? i.pts : 0), 0),
  );

  return { total, items };
}

/* ── Re-export SDK enum for consumers ────────────────────────────────────── */
export { CpmmCreatorFeeOn };
