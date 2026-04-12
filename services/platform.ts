/**
 * BASEDFARMS Platform Service — Raydium LaunchLab createPlatformConfig
 *
 * One-time admin operation. Creates a platform entry on-chain so BASEDFARMS
 * earns a share of every pool's trading fees and LP rewards.
 *
 * Store the resulting platformId in NEXT_PUBLIC_PLATFORM_ID env var.
 * Then every createLaunchpad() call will automatically route fees here.
 */
import {
  Raydium,
  TxVersion,
  LAUNCHPAD_PROGRAM,
  getPdaPlatformId,
} from '@raydium-io/raydium-sdk-v2';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';

/* ── RPC (mirrors services/launch.ts) ────────────────────────────────────── */

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

/* ── BASEDFARMS platform defaults ─────────────────────────────────────────── */

/**
 * Platform fee on each trade (bps × 100). 0 = no extra platform fee.
 * BASEDFARMS already earns 0.3% via shareFeeRate on every trade, so keep this 0.
 */
const PLATFORM_FEE_RATE = new BN(0);

/**
 * Maximum creator fee rate creators can set (bps × 100).
 * 10000 = 1%. Docs max is 50000 = 5%.
 */
const CREATOR_FEE_RATE = new BN(10000);

/**
 * LP distribution at migration — must sum to exactly 1,000,000.
 *
 * 5% → BASEDFARMS (Fee Key NFT, earns ongoing LP fees)
 * 10% → token creator (Fee Key NFT, earns ongoing LP fees)
 * 85% → permanently burned
 */
const LP_PLATFORM_SCALE = new BN(50_000);
const LP_CREATOR_SCALE  = new BN(100_000);
const LP_BURN_SCALE     = new BN(850_000);

/**
 * CPMM fee tier for migrated pools.
 * 0.25% tier — verified mainnet config.
 * Source: https://api-v3.raydium.io/main/cpmm-config
 */
const CPMM_CONFIG_ID = new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8');

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface CreatePlatformResult {
  txId: string;
  platformId: string;
}

/* ── Service ──────────────────────────────────────────────────────────────── */

/**
 * Creates the BASEDFARMS platform config on-chain.
 *
 * @param adminPublicKey   Connected admin wallet public key.
 * @param signTransaction  Wallet adapter signTransaction (signs a single tx).
 * @param meta             Optional overrides for platform name/url/image.
 */
export async function createPlatform(
  adminPublicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  meta?: { name?: string; web?: string; img?: string },
): Promise<CreatePlatformResult> {
  console.log('[Platform] createPlatform start, admin:', adminPublicKey.toBase58());

  const connection = getConn();
  const raydium = await loadRaydium(adminPublicKey);

  // Derive the platform PDA ahead of time so we can log it
  const derivedPlatformId = getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPublicKey).publicKey;
  console.log('[Platform] derived platformId:', derivedPlatformId.toBase58());

  // Build the transaction
  console.log('[Platform] calling raydium.launchpad.createPlatformConfig...');
  const result = await raydium.launchpad.createPlatformConfig({
    programId: LAUNCHPAD_PROGRAM,

    // All platform wallets point to the admin for now.
    // Transfer platformClaimFeeWallet to treasury after setup if desired.
    platformAdmin: adminPublicKey,
    platformClaimFeeWallet: adminPublicKey,
    platformLockNftWallet: adminPublicKey,
    platformVestingWallet: adminPublicKey,

    cpConfigId: CPMM_CONFIG_ID,
    transferFeeExtensionAuth: adminPublicKey,

    feeRate: PLATFORM_FEE_RATE,
    creatorFeeRate: CREATOR_FEE_RATE,

    migrateCpLockNftScale: {
      platformScale: LP_PLATFORM_SCALE,
      creatorScale: LP_CREATOR_SCALE,
      burnScale: LP_BURN_SCALE,
    },

    name: meta?.name ?? 'BASEDFARMS',
    web:  meta?.web  ?? 'https://basedfarms.com',
    img:  meta?.img  ?? 'https://basedfarms.com/logo.png',

    txVersion: TxVersion.LEGACY,
  });

  // SDK returns the raw transaction — extract it regardless of shape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = result as any;
  const tx: Transaction = r.transaction ?? r.transactions?.[0];
  if (!tx) throw new Error('[Platform] SDK returned no transaction');

  const signers: import('@solana/web3.js').Signer[] = r.signer ?? r.signers?.[0] ?? [];

  // Set blockhash and feePayer
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = adminPublicKey;

  // Pre-sign with any SDK-managed signers (typically none for platform config)
  if (signers.length > 0) {
    tx.sign(...signers);
  }

  // User (admin) signs
  console.log('[Platform] requesting wallet signature...');
  const signedTx = await signTransaction(tx);

  // Submit and confirm
  console.log('[Platform] sending transaction...');
  const txId = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  await connection.confirmTransaction({ signature: txId, blockhash, lastValidBlockHeight }, 'confirmed');
  console.log('[Platform] confirmed:', txId);

  // extInfo.platformId is the authoritative on-chain address
  const platformId: string = r.extInfo?.platformId?.toBase58?.() ?? derivedPlatformId.toBase58();
  console.log('[Platform] platformId:', platformId);

  return { txId, platformId };
}

/**
 * Derives the platform PDA for a given admin wallet without hitting the network.
 * Use to check if a platform already exists for your wallet.
 */
export function derivePlatformId(adminPublicKey: PublicKey): string {
  return getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPublicKey).publicKey.toBase58();
}
