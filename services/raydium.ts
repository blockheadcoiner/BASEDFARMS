/**
 * Raydium CPMM swap service
 *
 * Used for tokens launched on letsbonk.fun / Raydium CPMM (e.g. BGM).
 * Jupiter doesn't have liquidity for these pools; Raydium's on-chain AMM does.
 */
import {
  Raydium,
  TxVersion,
  WSOLMint,
  PoolFetchType,
  fetchMultipleMintInfos,
  Curve,
  getPdaLaunchpadPoolId,
  LAUNCHPAD_PROGRAM,
  PlatformConfig,
  type ApiV3PoolInfoStandardItemCpmm,
  type CpmmKeys,
  type CpmmComputeData,
} from '@raydium-io/raydium-sdk-v2';
import { NATIVE_MINT } from '@solana/spl-token';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import type { NormalizedQuote } from './types';

export type { NormalizedQuote };

/* ── Fetch interceptor (dev diagnostics) ────────────────────────────────── */
if (typeof window !== 'undefined') {
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url ?? String(args[0]);
    // Only log Solana RPC calls (JSON-RPC POST to an RPC endpoint)
    if (url.includes('solana') || url.includes('helius') || url.includes('ankr') || url.includes('rpc')) {
      console.log('[FETCH INTERCEPT] RPC →', url.slice(0, 80));
    }
    return origFetch.apply(this, args as Parameters<typeof fetch>);
  };
}

/* ── RPC connection ─────────────────────────────────────────────────────── */

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

console.log('[Raydium] RPC_URL:', RPC_URL.slice(0, 60));

/** Single connection instance used everywhere in this module */
function getConn(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

/* ── Constants ─────────────────────────────────────────────────────────── */
export const RAYDIUM_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const BGM_MINT = '3nZg1VZjT8qbeVPPKFmQmj6zbSw8D42RnxSeae3Qbonk';
const SLIPPAGE = 0.005; // 0.5 %

/** Slippage BN out of 10_000 (0.5 %) */
const LAUNCHPAD_SLIPPAGE_BPS = new BN(50);
const LAUNCHPAD_SLIPPAGE_UNIT = new BN(10_000);

/* ── Internal quote result types ────────────────────────────────────────── */
interface RaydiumQuoteResult {
  poolId: string;
  amountIn: BN;
  amountOut: BN;
  minAmountOut: BN;
  priceImpact: string; // percentage
  fee: BN;
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  poolKeys: CpmmKeys;
  computeData: CpmmComputeData;
  baseIn: boolean;
}

interface LaunchpadQuoteResult {
  mintA: string;
  amountIn: BN;
  amountOut: BN;
  minAmountOut: BN;
  bondingProgress: { raisedSol: number; targetSol: number; pct: number };
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Create a lightweight Raydium SDK instance — no token loading, fast init */
async function loadRaydium(owner?: PublicKey): Promise<Raydium> {
  const connection = getConn();
  // In the browser, proxy API calls through Next.js rewrites to avoid CORS
  const urlConfigs = typeof window !== 'undefined'
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

/** Find the CPMM pool ID for a mint pair via the Raydium API */
async function findCpmmPoolId(
  raydium: Raydium,
  mint1: string,
  mint2: string,
): Promise<string | null> {
  const url = `Raydium API fetchPoolByMints(${mint1.slice(0, 8)}…, ${mint2.slice(0, 8)}…)`;
  console.log('[Raydium]', url);

  const result = await raydium.api.fetchPoolByMints({
    mint1,
    mint2,
    type: PoolFetchType.Standard,
  });

  console.log('[Raydium] pools found:', result.data.length, result.data.map((p) => p.id));

  if (!result.data.length) return null;

  // CPMM pools have a `config` object but no `marketId` (AMM V4 has marketId)
  const cpmmPool = result.data.find(
    (p) => !('marketId' in p),
  ) as ApiV3PoolInfoStandardItemCpmm | undefined;

  if (!cpmmPool) {
    console.warn('[Raydium] only AMM V4 pools found — no CPMM pool for this pair');
    return null;
  }

  console.log('[Raydium] CPMM pool id:', cpmmPool.id, '| programId:', cpmmPool.programId);
  return cpmmPool.id;
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Fetch a Raydium CPMM quote for inputMint → outputMint.
 * Returns a NormalizedQuote compatible with SwapWidget.
 *
 * Throws 'POOL_NOT_FOUND' if no CPMM pool exists for the pair.
 */
export async function getRaydiumQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: number,
): Promise<NormalizedQuote> {
  console.log('[Raydium] getRaydiumQuote:', {
    inputMint: inputMint.slice(0, 8) + '…',
    outputMint: outputMint.slice(0, 8) + '…',
    amountLamports,
  });

  const connection = getConn();
  const raydium = await loadRaydium();

  // 1. Find pool
  const poolId = await findCpmmPoolId(raydium, inputMint, outputMint);
  if (!poolId) throw new Error('POOL_NOT_FOUND');

  // 2. Fetch on-chain pool state (true = also fetch config)
  console.log('[Raydium] getPoolInfoFromRpc:', poolId);
  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(poolId);

  // 3. Build CpmmComputeData (adds mintA/mintB/authority/id/version fields)
  const mintInfos = await fetchMultipleMintInfos({
    connection,
    mints: [rpcData.mintA, rpcData.mintB],
  });
  const computePoolInfos = raydium.cpmm.toComputePoolInfos({
    pools: { [poolId]: rpcData },
    mintInfos,
  });
  const computeData = computePoolInfos[poolId];

  console.log('[Raydium] pool mintA:', computeData.mintA.address, '| mintB:', computeData.mintB.address);
  console.log('[Raydium] reserves — base:', rpcData.baseReserve.toString(), '| quote:', rpcData.quoteReserve.toString());

  // 4. Determine swap direction
  //    baseIn = true  → input is mintA, output is mintB
  //    baseIn = false → input is mintB, output is mintA
  const wsolAddress = WSOLMint.toBase58();
  const normalizedInput = inputMint === RAYDIUM_SOL_MINT ? wsolAddress : inputMint;
  const baseIn = computeData.mintA.address === normalizedInput;
  console.log('[Raydium] baseIn:', baseIn, '(mintA is', computeData.mintA.address.slice(0, 8) + '…)');

  // 5. Compute quote
  const quote = raydium.cpmm.computeSwapAmount({
    pool: computeData,
    amountIn: new BN(amountLamports),
    outputMint,
    slippage: SLIPPAGE,
  });

  const priceImpactPct = (Math.abs(Number(quote.priceImpact?.toFixed?.(6) ?? 0)) * 100).toFixed(4);

  console.log('[Raydium] quote result:', {
    amountIn: quote.amountIn.toString(),
    amountOut: quote.amountOut.toString(),
    minAmountOut: quote.minAmountOut.toString(),
    priceImpactPct,
    fee: quote.fee.toString(),
  });

  const raw: RaydiumQuoteResult = {
    poolId,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    minAmountOut: quote.minAmountOut,
    priceImpact: priceImpactPct,
    fee: quote.fee,
    poolInfo: poolInfo as ApiV3PoolInfoStandardItemCpmm,
    poolKeys,
    computeData,
    baseIn,
  };

  return {
    router: 'raydium',
    outAmountRaw: quote.amountOut.toString(),
    minOutAmountRaw: quote.minAmountOut.toString(),
    priceImpactPct,
    route: 'Raydium CPMM',
    platformFeeSol: null, // Raydium fee is built into the pool
    slippageBps: SLIPPAGE * 10_000,
    _raydiumRaw: raw,
  };
}

/**
 * Build, sign, and send a Raydium CPMM swap transaction.
 * Returns the confirmed transaction signature.
 */
export async function executeRaydiumSwap(
  quote: NormalizedQuote,
  userPublicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
): Promise<string> {
  if (!quote._raydiumRaw) throw new Error('executeRaydiumSwap: missing Raydium quote data');
  const r = quote._raydiumRaw as RaydiumQuoteResult;

  console.log('[Raydium] executeRaydiumSwap: user=', userPublicKey.toBase58(), '| pool=', r.poolId);

  const connection = getConn();
  // Load SDK with user as owner so it can build token accounts
  const raydium = await loadRaydium(userPublicKey);

  // Build transaction
  const swapData = await raydium.cpmm.swap({
    poolInfo: r.poolInfo,
    poolKeys: r.poolKeys,
    baseIn: r.baseIn,
    inputAmount: r.amountIn,
    swapResult: {
      inputAmount: r.amountIn,
      outputAmount: r.amountOut,
    },
    slippage: SLIPPAGE,
    txVersion: TxVersion.LEGACY,
    computeBudgetConfig: {
      units: 600_000,
      microLamports: 100_000,
    },
  });

  const { transaction, signers } = swapData;

  // Set fresh blockhash and fee payer
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = userPublicKey;

  // Sign with any SDK-managed signers (e.g. ephemeral keypairs for wSOL wrapping)
  if (signers.length > 0) {
    console.log('[Raydium] signing with', signers.length, 'SDK signers');
    transaction.sign(...signers);
  }

  // Sign with user wallet
  console.log('[Raydium] requesting wallet signature…');
  const signed = await signTransaction(transaction);

  // Send & confirm
  console.log('[Raydium] sending…');
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  console.log('[Raydium] sent:', sig);

  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log('[Raydium] confirmed:', sig);
  return sig;
}

/**
 * Fetch a Raydium LaunchLab (bonding curve) quote for SOL → mintA.
 * Throws 'LAUNCHPAD_POOL_NOT_FOUND' if no launchpad pool exists for mintA.
 */
export async function getLaunchpadQuote(
  mintA: string,
  amountLamports: number,
): Promise<NormalizedQuote> {
  console.log('[Raydium/Launchpad] getLaunchpadQuote:', {
    mintA: mintA.slice(0, 8) + '…',
    amountLamports,
    rpc: RPC_URL.slice(0, 50),
    program: LAUNCHPAD_PROGRAM.toBase58().slice(0, 8) + '…',
  });

  // 1. Derive pool PDA — official SDK pattern: LAUNCHPAD_PROGRAM + mintA + NATIVE_MINT
  const mintAPk = new PublicKey(mintA);
  const { publicKey: poolId } = getPdaLaunchpadPoolId(LAUNCHPAD_PROGRAM, mintAPk, NATIVE_MINT);
  console.log('[Raydium/Launchpad] derived poolId:', poolId.toBase58());

  // 2. Load SDK (no owner needed for quote)
  const raydium = await loadRaydium();

  // 3. Fetch pool + config info via SDK — uses raydium.connection (= our Helius conn)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let poolInfo: any;
  try {
    poolInfo = await raydium.launchpad.getRpcPoolInfo({ poolId });
  } catch (err) {
    console.log('[Raydium/Launchpad] getRpcPoolInfo failed:', err);
    throw new Error('LAUNCHPAD_POOL_NOT_FOUND');
  }
  if (!poolInfo) throw new Error('LAUNCHPAD_POOL_NOT_FOUND');

  console.log('[Raydium/Launchpad] poolInfo | realB:', poolInfo.realB?.toString(),
    '| totalFundRaisingB:', poolInfo.totalFundRaisingB?.toString(),
    '| platformId:', poolInfo.platformId?.toBase58());

  // 4. Fetch platform config via raydium.connection (guaranteed to be our Helius conn)
  const platformData = await raydium.connection.getAccountInfo(poolInfo.platformId);
  if (!platformData) throw new Error('LAUNCHPAD_PLATFORM_NOT_FOUND');
  const platformInfo = PlatformConfig.decode(platformData.data);

  // 5. Get current slot
  const slot = await raydium.connection.getSlot('confirmed');

  // 6. Compute quote off-chain using bonding curve math
  const configInfo = poolInfo.configInfo;
  const quoteResult = Curve.buyExactIn({
    poolInfo,
    amountB: new BN(amountLamports),
    protocolFeeRate: configInfo.tradeFeeRate,
    platformFeeRate: platformInfo.feeRate,
    curveType: configInfo.curveType as number,
    shareFeeRate: new BN(0),
    creatorFeeRate: platformInfo.creatorFeeRate,
    transferFeeConfigA: undefined,
    slot,
  });

  const amountOut = quoteResult.amountA.amount;
  const minAmountOut = amountOut
    .mul(LAUNCHPAD_SLIPPAGE_UNIT.sub(LAUNCHPAD_SLIPPAGE_BPS))
    .div(LAUNCHPAD_SLIPPAGE_UNIT);

  console.log('[Raydium/Launchpad] quote:', {
    amountOut: amountOut.toString(),
    minAmountOut: minAmountOut.toString(),
  });

  // 7. Bonding curve graduation progress
  const raisedSol = poolInfo.realB.toNumber() / 1e9;
  const targetSol = poolInfo.totalFundRaisingB.toNumber() / 1e9;
  const pct = targetSol > 0 ? Math.min((raisedSol / targetSol) * 100, 100) : 0;
  const bondingProgress = { raisedSol, targetSol, pct };

  console.log('[Raydium/Launchpad] bonding progress:', bondingProgress);

  const raw: LaunchpadQuoteResult = {
    mintA,
    amountIn: new BN(amountLamports),
    amountOut,
    minAmountOut,
    bondingProgress,
  };

  return {
    router: 'raydium',
    subRouter: 'launchpad',
    outAmountRaw: amountOut.toString(),
    minOutAmountRaw: minAmountOut.toString(),
    priceImpactPct: '0.0000',
    route: 'Raydium LaunchLab',
    platformFeeSol: null,
    slippageBps: LAUNCHPAD_SLIPPAGE_BPS.toNumber(),
    bondingProgress,
    _raydiumRaw: raw,
  };
}

/**
 * Build, sign, and send a Raydium LaunchLab swap transaction.
 * Returns the confirmed transaction signature.
 */
export async function executeLaunchpadSwap(
  quote: NormalizedQuote,
  userPublicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
): Promise<string> {
  if (!quote._raydiumRaw) throw new Error('executeLaunchpadSwap: missing quote data');
  const r = quote._raydiumRaw as LaunchpadQuoteResult;

  console.log('[Raydium/Launchpad] executeLaunchpadSwap: user=', userPublicKey.toBase58(),
    '| mintA=', r.mintA.slice(0, 8) + '…', '| amountIn=', r.amountIn.toString());

  const connection = getConn();
  const raydium = await loadRaydium(userPublicKey);

  const txData = await raydium.launchpad.buyToken({
    programId: LAUNCHPAD_PROGRAM,
    mintA: new PublicKey(r.mintA),
    buyAmount: r.amountIn,
    minMintAAmount: r.minAmountOut,
    txVersion: TxVersion.LEGACY,
    computeBudgetConfig: {
      units: 600_000,
      microLamports: 100_000,
    },
  });

  const { transaction, signers } = txData as { transaction: Transaction; signers: import('@solana/web3.js').Signer[] };

  // Set fresh blockhash and fee payer
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = userPublicKey;

  if (signers.length > 0) {
    console.log('[Raydium/Launchpad] signing with', signers.length, 'SDK signers');
    transaction.sign(...signers);
  }

  console.log('[Raydium/Launchpad] requesting wallet signature…');
  const signed = await signTransaction(transaction);

  console.log('[Raydium/Launchpad] sending…');
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  console.log('[Raydium/Launchpad] sent:', sig);

  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log('[Raydium/Launchpad] confirmed:', sig);
  return sig;
}

/**
 * Fetch live BGM/SOL pool info.
 * Returns null if no pool exists yet.
 */
export async function getBGMPoolInfo(): Promise<{
  poolId: string;
  price: number;
  mintA: string;
  mintB: string;
  baseReserve: string;
  quoteReserve: string;
} | null> {
  console.log('[Raydium] getBGMPoolInfo');
  try {
    const raydium = await loadRaydium();
    const poolId = await findCpmmPoolId(raydium, RAYDIUM_SOL_MINT, BGM_MINT);
    if (!poolId) return null;

    const rpcData = await raydium.cpmm.getRpcPoolInfo(poolId, false);
    return {
      poolId,
      price: rpcData.poolPrice.toNumber(),
      mintA: rpcData.mintA.toBase58(),
      mintB: rpcData.mintB.toBase58(),
      baseReserve: rpcData.baseReserve.toString(),
      quoteReserve: rpcData.quoteReserve.toString(),
    };
  } catch (err) {
    console.error('[Raydium] getBGMPoolInfo error:', err);
    return null;
  }
}
