/**
 * Raydium permissionless farm service (Farm V6)
 *
 * Wraps Raydium SDK farm operations for BASEDFARMS:
 *   - getLaunchpadPoolStatus  — check bonding-curve graduation
 *   - getCpmmPoolForToken     — find the CPMM pool post-migration
 *   - createRaydiumFarm       — deploy a V6 staking farm on an LP
 *   - stakeLp                 — deposit LP tokens
 *   - unstakeLp               — withdraw LP tokens
 *   - harvestRewards          — claim pending rewards
 *   - getFarmInfo             — fetch farm metadata from Raydium API
 *   - getUserFarmPosition     — read user's on-chain ledger account
 */
import {
  Raydium,
  TxVersion,
  LAUNCHPAD_PROGRAM,
  DEVNET_PROGRAM_ID,
  getPdaLaunchpadPoolId,
  LaunchpadPool,
  FARM_LOCK_MINT,
  FARM_LOCK_VAULT,
  DEV_FARM_LOCK_MINT,
  DEV_FARM_LOCK_VAULT,
  poolTypeV6,
  PoolFetchType,
  getAssociatedLedgerAccount,
  getFarmLedgerLayout,
  type FarmRewardInfo,
  type FormatFarmInfoOut,
  type ApiV3PoolInfoStandardItem,
  type ApiV3PoolInfoStandardItemCpmm,
} from '@raydium-io/raydium-sdk-v2';
import { NATIVE_MINT } from '@solana/spl-token';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

/* ── Network config ─────────────────────────────────────────────────────── */

const IS_DEVNET = process.env.NEXT_PUBLIC_LAUNCH_NETWORK === 'devnet';

const LAUNCH_PROGRAM_ID = IS_DEVNET
  ? DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM
  : LAUNCHPAD_PROGRAM;

const LOCK_MINT  = IS_DEVNET ? DEV_FARM_LOCK_MINT  : FARM_LOCK_MINT;
const LOCK_VAULT = IS_DEVNET ? DEV_FARM_LOCK_VAULT : FARM_LOCK_VAULT;

const RPC_URL = IS_DEVNET
  ? 'https://api.devnet.solana.com'
  : (() => {
      const url = process.env.NEXT_PUBLIC_RPC_URL;
      if (url && url.startsWith('https://')) return url;
      return 'https://mainnet.helius-rpc.com/?api-key=229cc849-fb9c-4ef0-968a-a0402480d121';
    })();

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function getConn(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

async function loadRaydium(owner?: PublicKey): Promise<Raydium> {
  const connection = getConn();
  const urlConfigs = !IS_DEVNET && typeof window !== 'undefined'
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

/* ── Public types ────────────────────────────────────────────────────────── */

export type { FarmRewardInfo, FormatFarmInfoOut };

export interface LaunchpadPoolStatus {
  /** 0 = Trading, 1 = Migrating, 2 = Migrated */
  status: number;
  raisedSol: number;
  targetSol: number;
  pct: number;
}

export interface UserFarmPosition {
  /** LP tokens deposited (raw, in LP mint's decimals) */
  deposited: BN;
  /** Reward debt accumulators (one per reward token) */
  rewardDebts: BN[];
}

/* ── getLaunchpadPoolStatus ──────────────────────────────────────────────── */

/**
 * Fetch the bonding-curve pool state for a token.
 * Returns null if no LaunchLab pool exists for this mint.
 */
export async function getLaunchpadPoolStatus(
  tokenMint: string | PublicKey,
): Promise<LaunchpadPoolStatus | null> {
  const mintPk = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
  const connection = getConn();

  const poolId = getPdaLaunchpadPoolId(LAUNCH_PROGRAM_ID, mintPk, NATIVE_MINT).publicKey;
  const acct = await connection.getAccountInfo(poolId, 'confirmed');
  if (!acct) return null;

  const pool = LaunchpadPool.decode(acct.data);
  const raisedSol = pool.realB.toNumber() / 1e9;
  const targetSol = pool.totalFundRaisingB.toNumber() / 1e9;
  const pct = targetSol > 0 ? (raisedSol / targetSol) * 100 : 0;

  return { status: pool.status, raisedSol, targetSol, pct };
}

/* ── getCpmmPoolForToken ─────────────────────────────────────────────────── */

/**
 * Find the CPMM pool that was created when this token graduated.
 * Returns null if no CPMM pool is found.
 */
export async function getCpmmPoolForToken(
  tokenMint: string,
): Promise<ApiV3PoolInfoStandardItemCpmm | null> {
  const raydium = await loadRaydium();
  const result = await raydium.api.fetchPoolByMints({
    mint1: tokenMint,
    mint2: NATIVE_MINT.toBase58(),
    type: PoolFetchType.Standard,
  });

  const cpmmPool = result.data.find(
    (p) => !('marketId' in p),
  ) as ApiV3PoolInfoStandardItemCpmm | undefined;

  return cpmmPool ?? null;
}

/* ── createRaydiumFarm ───────────────────────────────────────────────────── */

export interface CreateFarmParams {
  /** CPMM pool info (from getCpmmPoolForToken) */
  poolInfo: ApiV3PoolInfoStandardItem;
  /** Reward configuration — at least one entry required */
  rewardInfos: FarmRewardInfo[];
  userPublicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

/**
 * Deploy a new Raydium V6 permissionless farm on top of a CPMM pool.
 * Returns the on-chain farm ID.
 */
export async function createRaydiumFarm(
  params: CreateFarmParams,
): Promise<{ farmId: string; txId: string }> {
  const { poolInfo, rewardInfos, userPublicKey, signTransaction } = params;
  const connection = getConn();
  const raydium = await loadRaydium(userPublicKey);

  const { transaction, signers, extInfo } = await raydium.farm.create({
    poolInfo,
    rewardInfos,
    payer: userPublicKey,
    txVersion: TxVersion.LEGACY,
    lockProgram: { mint: LOCK_MINT, vault: LOCK_VAULT },
    computeBudgetConfig: { units: 600_000, microLamports: 150_000 },
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = userPublicKey;

  if (signers.length > 0) transaction.sign(...signers);

  const signed = await signTransaction(transaction);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  return { farmId: extInfo.farmId.toBase58(), txId: sig };
}

/* ── stakeLp ─────────────────────────────────────────────────────────────── */

export interface StakeLpParams {
  farmInfo: FormatFarmInfoOut;
  /** Amount in LP mint's raw units */
  amount: BN;
  userPublicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

/** Deposit LP tokens into a farm. */
export async function stakeLp(params: StakeLpParams): Promise<{ txId: string }> {
  const { farmInfo, amount, userPublicKey, signTransaction } = params;
  const connection = getConn();
  const raydium = await loadRaydium(userPublicKey);

  const { transaction, signers } = await raydium.farm.deposit({
    farmInfo,
    amount,
    txVersion: TxVersion.LEGACY,
    computeBudgetConfig: { units: 400_000, microLamports: 100_000 },
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = userPublicKey;

  if (signers.length > 0) transaction.sign(...signers);

  const signed = await signTransaction(transaction);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  return { txId: sig };
}

/* ── unstakeLp ───────────────────────────────────────────────────────────── */

export interface UnstakeLpParams {
  farmInfo: FormatFarmInfoOut;
  /** Amount in LP mint's raw units */
  amount: BN;
  userPublicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

/** Withdraw LP tokens from a farm. */
export async function unstakeLp(params: UnstakeLpParams): Promise<{ txId: string }> {
  const { farmInfo, amount, userPublicKey, signTransaction } = params;
  const connection = getConn();
  const raydium = await loadRaydium(userPublicKey);

  const { transaction, signers } = await raydium.farm.withdraw({
    farmInfo,
    amount,
    txVersion: TxVersion.LEGACY,
    computeBudgetConfig: { units: 400_000, microLamports: 100_000 },
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = userPublicKey;

  if (signers.length > 0) transaction.sign(...signers);

  const signed = await signTransaction(transaction);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  return { txId: sig };
}

/* ── harvestRewards ──────────────────────────────────────────────────────── */

export interface HarvestRewardsParams {
  farmInfo: FormatFarmInfoOut;
  userPublicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

/** Claim all pending rewards from a farm. */
export async function harvestRewards(params: HarvestRewardsParams): Promise<{ txId: string }> {
  const { farmInfo, userPublicKey, signTransaction } = params;
  const connection = getConn();
  const raydium = await loadRaydium(userPublicKey);

  const multiTx = await raydium.farm.harvestAllRewards({
    farmInfoList: { [farmInfo.id]: farmInfo },
    useSOLBalance: true,
    txVersion: TxVersion.LEGACY,
    computeBudgetConfig: { units: 400_000, microLamports: 100_000 },
  });

  // harvestAllRewards can return multiple txs; sign and send each sequentially
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  let lastSig = '';

  for (let i = 0; i < multiTx.transactions.length; i++) {
    const tx = multiTx.transactions[i];
    const txSigners = multiTx.signers[i] ?? [];

    tx.recentBlockhash = blockhash;
    tx.feePayer = userPublicKey;
    if (txSigners.length > 0) tx.sign(...txSigners);

    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    lastSig = sig;
  }

  return { txId: lastSig };
}

/* ── getFarmInfo ─────────────────────────────────────────────────────────── */

/**
 * Fetch farm metadata from the Raydium API by farm ID.
 * Returns null if the farm ID is not found.
 */
export async function getFarmInfo(farmId: string): Promise<FormatFarmInfoOut | null> {
  const raydium = await loadRaydium();
  const results = await raydium.api.fetchFarmInfoById({ ids: farmId });
  return results[0] ?? null;
}

/* ── getUserFarmPosition ─────────────────────────────────────────────────── */

/**
 * Read the user's on-chain ledger account for a given farm.
 * Returns null if the user has no position (account doesn't exist).
 *
 * @param farmId     Farm public key (from FormatFarmInfoOut.id)
 * @param programId  Farm program ID (from FormatFarmInfoOut.programId)
 * @param owner      User wallet public key
 */
export async function getUserFarmPosition(
  farmId: string | PublicKey,
  programId: string | PublicKey,
  owner: PublicKey,
): Promise<UserFarmPosition | null> {
  const connection = getConn();
  const farmPk    = typeof farmId    === 'string' ? new PublicKey(farmId)    : farmId;
  const programPk = typeof programId === 'string' ? new PublicKey(programId) : programId;

  const ledgerPk = getAssociatedLedgerAccount({
    programId: programPk,
    poolId: farmPk,
    owner,
    version: 6,
  });

  const acct = await connection.getAccountInfo(ledgerPk, 'confirmed');
  if (!acct) return null;

  const layout = getFarmLedgerLayout(6);
  if (!layout) return null;

  const ledger = layout.decode(acct.data);
  return {
    deposited: ledger.deposited as BN,
    rewardDebts: ledger.rewardDebts as BN[],
  };
}

/* ── RewardType convenience re-export ────────────────────────────────────── */

/** "Standard SPL" | "Option tokens" — use for FarmRewardInfo.rewardType */
export const RewardType = poolTypeV6;
