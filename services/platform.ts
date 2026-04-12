/**
 * BASEDFARMS Platform Service — Raydium LaunchLab platform management
 *
 * THREE INCOME STREAMS per token launched on BASEDFARMS:
 *
 *  1. BONDING CURVE — SHARE FEE (0.3%)
 *     shareFeeRate in createLaunchpad() → direct to treasury on every buy/sell.
 *     Works immediately, no platform needed, no claiming required.
 *
 *  2. BONDING CURVE — PLATFORM FEE (0.5%)
 *     Accumulates in a per-platform vault for every bonding curve trade.
 *     Requires platformId in createLaunchpad(). Claim via claimBondingCurveFees().
 *
 *  3. POST-GRADUATION — CPMM LP FEES (~5% of all trading fees, forever)
 *     At graduation, BASEDFARMS receives a Fee Key NFT representing a 5% LP position.
 *     The CPMM pool generates trading fees from every trade on Raydium forever.
 *     Claim via harvestCpmmLpFees() — call periodically or on-demand.
 *
 * Setup:
 *   1. Run createPlatform() from /admin once — costs ~0.01 SOL
 *   2. Save the platformId to NEXT_PUBLIC_PLATFORM_ID env var
 *   3. Every createLaunchpad() call thereafter routes fees here
 *   4. Call claimBondingCurveFees() + harvestCpmmLpFees() periodically to collect
 */
import {
  Raydium as RaydiumSDK,
  TxVersion,
  LAUNCHPAD_PROGRAM,
  LOCK_CPMM_PROGRAM,
  LOCK_CPMM_AUTH,
  getPdaPlatformId,
} from '@raydium-io/raydium-sdk-v2';
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';

/* ── RPC ─────────────────────────────────────────────────────────────────── */

const RPC_URL = (() => {
  const url = process.env.NEXT_PUBLIC_RPC_URL;
  if (url && url.startsWith('https://')) return url;
  return 'https://mainnet.helius-rpc.com/?api-key=229cc849-fb9c-4ef0-968a-a0402480d121';
})();

function getConn(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

async function loadRaydium(owner: PublicKey): Promise<RaydiumSDK> {
  const connection = getConn();
  const urlConfigs =
    typeof window !== 'undefined'
      ? { BASE_HOST: '/api/raydium-v3', SWAP_HOST: '/api/raydium' }
      : {};
  return RaydiumSDK.load({
    connection,
    owner,
    cluster: 'mainnet',
    disableLoadToken: true,
    disableFeatureCheck: true,
    blockhashCommitment: 'confirmed',
    urlConfigs,
  });
}

/* ── Tx helper — sign one LEGACY transaction ─────────────────────────────── */

async function signAndSend(
  connection: Connection,
  tx: Transaction,
  feePayer: PublicKey,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraSigners: any[],
  signTransaction: (tx: Transaction) => Promise<Transaction>,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer;
  if (extraSigners.length > 0) tx.sign(...extraSigners);
  const signed = await signTransaction(tx);
  const txId = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: txId, blockhash, lastValidBlockHeight }, 'confirmed');
  return txId;
}

/* ── BASEDFARMS platform constants ───────────────────────────────────────── */

/**
 * BASEDFARMS treasury — receives platform claims, Fee Key NFTs, and vesting.
 */
const TREASURY_ADDRESS =
  process.env.NEXT_PUBLIC_TREASURY_WALLET ??
  '6MB3syAmv6rmVavKxZveDdPYrmmwGcwoM2BfkDbfkQd8';

function getTreasury(): PublicKey {
  return new PublicKey(TREASURY_ADDRESS);
}

/**
 * Stream 2: Platform fee on each bonding curve trade (bps × 100).
 * 10000 = 1%. Accumulates in a vault; claimed via claimBondingCurveFees().
 * This is on top of the 0.3% shareFeeRate that goes directly to treasury.
 */
const PLATFORM_FEE_RATE = new BN(10_000); // 1%

/**
 * Max creator fee creators can set on their own token (bps × 100).
 * 5000 = 0.5%. Docs max is 50000 = 5%.
 */
const CREATOR_FEE_RATE = new BN(5_000); // 0.5%

/**
 * Stream 3: LP distribution at graduation — must sum to exactly 1,000,000.
 *
 * BASEDFARMS 10%  → Fee Key NFT → ongoing CPMM LP trading fees
 * Creator    10%  → Fee Key NFT → creator's ongoing CPMM LP trading fees
 * Burned     80%  → locked forever, supports token price floor
 */
const LP_PLATFORM_SCALE = new BN(100_000);  // 10%
const LP_CREATOR_SCALE  = new BN(100_000);  // 10%
const LP_BURN_SCALE     = new BN(800_000);  // 80%

/**
 * CPMM fee tier for migrated pools (0.25% trading fee tier — lowest available).
 * Source: https://api-v3.raydium.io/main/cpmm-config → index 0, tradeFeeRate 2500
 */
const CPMM_CONFIG_ID = new PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface CreatePlatformResult {
  txId: string;
  platformId: string;
}

export interface ClaimFeesResult {
  txId: string;
  claimed: 'platform-vault';
}

export interface HarvestLpResult {
  txIds: string[];
  positionsHarvested: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE (one-time setup)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Registers BASEDFARMS as a Raydium LaunchLab platform.
 * Run ONCE from /admin/platform. Save the returned platformId to NEXT_PUBLIC_PLATFORM_ID.
 *
 * After this, every token launched with that platformId will:
 *   - Route 1% of bonding curve trades to BASEDFARMS vault (Stream 2)
 *   - Give BASEDFARMS a Fee Key NFT (10% LP) at graduation (Stream 3)
 */
export async function createPlatform(
  adminPublicKey: PublicKey,
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>,
): Promise<CreatePlatformResult> {
  console.log('[Platform] createPlatform, admin:', adminPublicKey.toBase58());

  const connection = getConn();

  // Load Raydium with signAllTransactions so execute() can sign V0 txs
  const urlConfigs =
    typeof window !== 'undefined'
      ? { BASE_HOST: '/api/raydium-v3', SWAP_HOST: '/api/raydium' }
      : {};
  const raydium = await RaydiumSDK.load({
    connection,
    owner: adminPublicKey,
    cluster: 'mainnet',
    disableLoadToken: true,
    disableFeatureCheck: true,
    blockhashCommitment: 'confirmed',
    signAllTransactions,
    urlConfigs,
  });

  const derivedPlatformId = getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPublicKey).publicKey;
  console.log('[Platform] derived platformId:', derivedPlatformId.toBase58());

  const { execute, extInfo } = await raydium.launchpad.createPlatformConfig({
    programId: LAUNCHPAD_PROGRAM,
    platformAdmin: adminPublicKey,
    platformClaimFeeWallet: getTreasury(),   // Stream 2 claims → treasury
    platformLockNftWallet: getTreasury(),    // Fee Key NFTs → treasury
    platformVestingWallet: getTreasury(),    // Vesting wallet → treasury
    transferFeeExtensionAuth: adminPublicKey,
    cpConfigId: CPMM_CONFIG_ID,
    feeRate: PLATFORM_FEE_RATE,
    creatorFeeRate: CREATOR_FEE_RATE,
    migrateCpLockNftScale: {
      platformScale: LP_PLATFORM_SCALE,
      creatorScale: LP_CREATOR_SCALE,
      burnScale: LP_BURN_SCALE,
    },
    name: 'BASEDFARMS',
    web:  'https://basedfarms.fun',
    img:  'https://basedfarms.fun/tokens/bgm-logo.png',
    txVersion: TxVersion.V0,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execResult: any = await execute({ sendAndConfirm: true });
  const txId: string = execResult.txId ?? execResult.txIds?.[0] ?? '';
  const platformId = extInfo.platformId?.toBase58?.() ?? derivedPlatformId.toBase58();
  console.log('[Platform] created:', { txId, platformId });

  return { txId, platformId };
}

/**
 * Derives the platform PDA without a network call.
 * Use to preview the platformId before creating it.
 */
export function derivePlatformId(adminPublicKey: PublicKey): string {
  return getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPublicKey).publicKey.toBase58();
}

/* ═══════════════════════════════════════════════════════════════════════════
   STREAM 2 — Claim bonding curve platform vault fees
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Claims accumulated bonding curve trading fees (Stream 2) from the
 * platform vault. Call whenever you want to collect — fees accumulate
 * for every buy/sell on tokens launched under this platformId.
 *
 * Currently all LaunchLab pools use WSOL (NATIVE_MINT) as quote token.
 */
export async function claimBondingCurveFees(
  adminPublicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  platformId: PublicKey,
): Promise<ClaimFeesResult> {
  console.log('[Platform] claimBondingCurveFees, platformId:', platformId.toBase58());

  const connection = getConn();
  const raydium = await loadRaydium(adminPublicKey);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await raydium.launchpad.claimVaultPlatformFee({
    programId: LAUNCHPAD_PROGRAM,
    platformId,
    claimFeeWallet: adminPublicKey,
    mintB: NATIVE_MINT,
    txVersion: TxVersion.LEGACY,
  });

  const tx: Transaction = result.transaction ?? result.transactions?.[0];
  if (!tx) throw new Error('[Platform] claimVaultPlatformFee: no transaction returned');
  const signers = result.signer ?? result.signers?.[0] ?? [];

  const txId = await signAndSend(connection, tx, adminPublicKey, signers, signTransaction);
  console.log('[Platform] platform vault claimed:', txId);
  return { txId, claimed: 'platform-vault' };
}

/* ═══════════════════════════════════════════════════════════════════════════
   STREAM 3 — Harvest CPMM LP fees from graduated tokens
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Helius DAS helper ───────────────────────────────────────────────────── */

/**
 * Returns the Helius API key embedded in RPC_URL, or null if not using Helius.
 * Pattern: https://mainnet.helius-rpc.com/?api-key=<KEY>
 */
function getHeliusApiKey(): string | null {
  const match = RPC_URL.match(/api-key=([^&]+)/);
  return match ? match[1] : null;
}

interface DasAsset {
  id: string;
  content?: {
    json_uri?: string;
    metadata?: { name?: string };
  };
}

/**
 * Fetches all NFT mints owned by `owner` using Helius DAS getAssetsByOwner.
 * Paginates automatically; filters to those whose json_uri contains the
 * Raydium CPMM lock metadata endpoint.
 */
async function findCpmmLockNfts(owner: PublicKey): Promise<string[]> {
  const apiKey = getHeliusApiKey();
  if (!apiKey) {
    console.warn('[Platform] No Helius API key — cannot discover Fee Key NFTs via DAS');
    return [];
  }

  const endpoint = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const CPMM_LOCK_URI = 'dynamic-ipfs.raydium.io/lock/cpmm/position';
  const nftMints: string[] = [];
  let page = 1;

  while (true) {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `harvest-${page}`,
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: owner.toBase58(),
          page,
          limit: 1000,
          displayOptions: { showFungible: false, showNativeBalance: false },
        },
      }),
    });

    if (!resp.ok) {
      console.error('[Platform] DAS getAssetsByOwner HTTP error:', resp.status);
      break;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await resp.json();
    const items: DasAsset[] = json?.result?.items ?? [];

    for (const asset of items) {
      const uri = asset.content?.json_uri ?? '';
      if (uri.includes(CPMM_LOCK_URI)) {
        nftMints.push(asset.id);
        console.log('[Platform] found Fee Key NFT:', asset.id, 'uri:', uri);
      }
    }

    if (items.length < 1000) break; // last page
    page++;
  }

  return nftMints;
}

/** Fetch CPMM lock NFT metadata from its URI (contains poolInfo + lpFeeAmount). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchNftMetadata(nftMint: string): Promise<any | null> {
  const apiKey = getHeliusApiKey();
  if (!apiKey) return null;

  // Fetch the NFT's json_uri via DAS getAsset
  const endpoint = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'get-asset',
      method: 'getAsset',
      params: { id: nftMint },
    }),
  });
  if (!resp.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await resp.json();
  const jsonUri: string = json?.result?.content?.json_uri ?? '';
  if (!jsonUri) return null;

  // Fetch metadata JSON from the URI
  const metaResp = await fetch(jsonUri);
  if (!metaResp.ok) return null;
  return metaResp.json();
}

/* ═══════════════════════════════════════════════════════════════════════════
   STREAM 3 — Harvest CPMM LP fees from graduated tokens
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Harvests LP trading fees for every graduated token (Stream 3).
 *
 * When a token hits its SOL target and graduates, the bonding curve liquidity
 * migrates to a Raydium CPMM pool. BASEDFARMS receives a Fee Key NFT
 * representing a 5% LP position in that pool. Every trade on the CPMM pool
 * generates fees proportional to LP share — this function collects them.
 *
 * Discovery: uses Helius DAS getAssetsByOwner to enumerate Fee Key NFTs,
 * then fetches each NFT's metadata URI for poolInfo + lpFeeAmount.
 *
 * Call periodically (e.g. weekly) or whenever you want to harvest.
 * The admin wallet must hold the Fee Key NFTs for positions to be found.
 *
 * @returns txIds for each position harvested (one tx per graduated token)
 */
export async function harvestCpmmLpFees(
  adminPublicKey: PublicKey,
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>,
): Promise<HarvestLpResult> {
  console.log('[Platform] harvestCpmmLpFees, wallet:', adminPublicKey.toBase58());

  const connection = getConn();
  const raydium = await loadRaydium(adminPublicKey);

  // Step 1: Discover all Fee Key NFTs held by the admin wallet
  const nftMints = await findCpmmLockNfts(adminPublicKey);
  console.log('[Platform] found', nftMints.length, 'Fee Key NFT(s)');

  if (nftMints.length === 0) {
    return { txIds: [], positionsHarvested: 0 };
  }

  // Step 2: Fetch metadata for each NFT to get poolInfo + lpFeeAmount
  type LockEntry = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    poolInfo: any;
    nftMint: PublicKey;
    lpFeeAmount: BN;
  };

  const lockInfo: LockEntry[] = [];
  for (const mint of nftMints) {
    const meta = await fetchNftMetadata(mint);
    if (!meta?.poolInfo) {
      console.warn('[Platform] missing poolInfo in metadata for NFT:', mint);
      continue;
    }
    const lpFeeRaw: string = meta?.positionInfo?.unclaimedFee?.lp ?? '0';
    lockInfo.push({
      poolInfo: meta.poolInfo,
      nftMint: new PublicKey(mint),
      lpFeeAmount: new BN(lpFeeRaw),
    });
  }

  if (lockInfo.length === 0) {
    console.warn('[Platform] no harvestable positions found (all NFTs missing metadata or 0 fees)');
    return { txIds: [], positionsHarvested: 0 };
  }

  // Step 3: Build harvest transactions via harvestMultiLockLp
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await raydium.cpmm.harvestMultiLockLp({
    lockInfo,
    programId: LOCK_CPMM_PROGRAM,
    authProgram: LOCK_CPMM_AUTH,
    txVersion: TxVersion.LEGACY,
  });

  const rawTxs: Transaction[] = Array.isArray(result.transactions)
    ? result.transactions
    : result.transaction
    ? [result.transaction]
    : [];

  if (rawTxs.length === 0) {
    return { txIds: [], positionsHarvested: 0 };
  }

  // Apply blockhash + fee payer to all txs
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  for (const tx of rawTxs) {
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminPublicKey;
    const signers = result.signer ?? result.signers ?? [];
    if (signers.length > 0) tx.sign(...signers);
  }

  // Sign all at once — one wallet popup for all positions
  console.log('[Platform] requesting wallet to sign', rawTxs.length, 'harvest tx(s)...');
  const signedTxs = await signAllTransactions(rawTxs) as Transaction[];

  // Submit sequentially and collect signatures
  const txIds: string[] = [];
  for (const signed of signedTxs) {
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    txIds.push(sig);
    console.log('[Platform] harvested LP position:', sig);
  }

  console.log('[Platform] harvest complete:', { txIds, positionsHarvested: txIds.length });
  return { txIds, positionsHarvested: txIds.length };
}
