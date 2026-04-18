/**
 * Streamflow vesting service — audited token vesting via Streamflow Finance
 *
 * Replaces Raydium-native vesting (createVesting / totalLockedAmount).
 * Streamflow contracts are audited by FYEO + Opcodes.
 *
 * SDK: @streamflow/stream v11.x
 * Dashboard: https://app.streamflow.finance
 */
import { SolanaStreamClient, ICluster } from '@streamflow/stream';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import BN from 'bn.js';

import { IS_DEVNET, LAUNCH_RPC } from './launch';

/* ── Constants ────────────────────────────────────────────────────────────── */

const STREAMFLOW_CLUSTER = IS_DEVNET ? ICluster.Devnet : ICluster.Mainnet;

const DASHBOARD_BASE = IS_DEVNET
  ? 'https://app.streamflow.finance/streams/solana/devnet'
  : 'https://app.streamflow.finance/streams/solana/mainnet';

/* ── Types ────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WalletAdapter = any;

export interface CreateVestingParams {
  /** Connected wallet adapter — used as the stream sender/payer */
  wallet: WalletAdapter;
  /** Creator's wallet public key (base58) — used to verify token balance before vesting */
  creatorPublicKey: string;
  /** Recipient wallet address (base58 string) */
  recipient: string;
  /** Token mint address (base58 string) */
  mint: string;
  /** Total tokens to lock in raw units (including decimals) */
  totalAmount: BN;
  /** Number of days before any tokens unlock (0 = no cliff) */
  cliffDays: number;
  /** Total vesting duration in days (tokens unlock linearly after cliff) */
  unlockDays: number;
  /** Human-readable label stored on the stream contract */
  tokenName: string;
}

export interface CreateVestingResult {
  /** Streamflow stream / contract ID (the metadata account address) */
  streamId: string;
  /** Transaction signature */
  txId: string;
  /** Direct link to the stream on app.streamflow.finance */
  dashboardUrl: string;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function getClient(): SolanaStreamClient {
  return new SolanaStreamClient(LAUNCH_RPC, STREAMFLOW_CLUSTER);
}

/**
 * Converts a fractional days value to whole seconds, minimum 1.
 */
function daysToSeconds(days: number): number {
  return Math.max(1, Math.round(days * 86_400));
}

/* ── Main export ──────────────────────────────────────────────────────────── */

/**
 * Creates a Streamflow linear vesting contract for a launched token.
 *
 * Tokens unlock linearly every second after the cliff, until all
 * `totalAmount` tokens have been released to the recipient.
 *
 * Fees: Streamflow charges a small creation fee in SOL (paid by sender).
 *
 * @returns Stream ID, tx signature, and dashboard URL.
 */
export async function createVestingStream(
  params: CreateVestingParams,
): Promise<CreateVestingResult> {
  const { wallet, creatorPublicKey, recipient, mint, totalAmount, cliffDays, unlockDays, tokenName } = params;

  const cliffSeconds = daysToSeconds(cliffDays);
  const unlockSeconds = daysToSeconds(unlockDays);

  // Start time: 30 seconds from now (gives time for tx to land)
  const start = Math.floor(Date.now() / 1_000) + 30;

  // Cliff absolute timestamp
  const cliff = cliffDays > 0 ? start + cliffSeconds : start;

  // Period = 1 second (linear unlock every second after cliff)
  const period = 1;

  // amountPerPeriod: how many raw token units unlock per second after cliff
  // Vesting duration = unlockSeconds total; cliff tokens given at cliff
  // For simplicity: no cliff amount — all tokens vest linearly from cliff → end
  const cliffAmount = new BN(0);
  const vestDuration = unlockSeconds; // seconds from cliff to full unlock
  const amountPerPeriod = totalAmount.divn(vestDuration > 0 ? vestDuration : 1);
  // Remainder — distribute cliffAmount to absorb rounding
  const remainder = totalAmount.sub(amountPerPeriod.muln(vestDuration));
  const adjustedCliffAmount = remainder.gtn(0) ? remainder : new BN(0);

  const client = getClient();
  const connection = new Connection(LAUNCH_RPC, 'confirmed');
  const mintPubkey = new PublicKey(mint);

  // ── DETAILED DEBUG BLOCK ──────────────────────────────────────────────────
  console.log('===== STREAMFLOW VESTING DEBUG =====');
  console.log('Mint:', mint.toString());
  console.log('Recipient:', recipient.toString());
  console.log('creatorPublicKey param:', creatorPublicKey);
  try {
    console.log('wallet.publicKey:', wallet.publicKey?.toString() ?? 'undefined');
  } catch { console.log('wallet.publicKey: error reading'); }

  // Check ATA from creatorPublicKey param (what our pre-flight uses)
  const creatorPubkey = new PublicKey(creatorPublicKey);
  const creatorAta = await getAssociatedTokenAddress(mintPubkey, creatorPubkey);
  console.log('Creator ATA (from creatorPublicKey):', creatorAta.toString());
  try {
    const bal1 = await connection.getTokenAccountBalance(creatorAta);
    console.log('Creator ATA balance raw:', bal1.value.amount);
    console.log('Creator ATA balance ui:', bal1.value.uiAmount);
    console.log('Creator ATA decimals:', bal1.value.decimals);
  } catch (e) {
    console.log('Creator ATA does not exist or error:', (e as Error).message);
  }

  // Check ATA from wallet.publicKey (what Streamflow SDK will use as sender)
  if (wallet.publicKey) {
    const senderAta = await getAssociatedTokenAddress(mintPubkey, wallet.publicKey);
    console.log('Sender ATA (from wallet.publicKey):', senderAta.toString());
    try {
      const bal2 = await connection.getTokenAccountBalance(senderAta);
      console.log('Sender ATA balance raw:', bal2.value.amount);
      console.log('Sender ATA balance ui:', bal2.value.uiAmount);
      console.log('Sender decimals:', bal2.value.decimals);
    } catch (e) {
      console.log('Sender ATA does not exist or has no balance:', (e as Error).message);
    }
  } else {
    console.log('wallet.publicKey is null/undefined — Streamflow cannot determine sender');
  }

  const totalPeriods = vestDuration;
  console.log('Total amount to vest:', totalAmount.toString());
  console.log('Amount per period:', amountPerPeriod.toString());
  console.log('Total periods:', totalPeriods);
  console.log('adjustedCliffAmount:', adjustedCliffAmount.toString());
  console.log('Final amount vested:', totalAmount.toString());
  console.log('Calling Streamflow create()...');
  // ── END DEBUG BLOCK ───────────────────────────────────────────────────────

  // Pre-flight guard: throw early with actionable message if balance is short
  let creatorBalance = new BN(0);
  try {
    const balanceResp = await connection.getTokenAccountBalance(creatorAta);
    creatorBalance = new BN(balanceResp.value.amount);
  } catch { /* ATA missing — balance stays 0 */ }

  if (creatorBalance.lt(totalAmount)) {
    const haveUi = creatorBalance.toNumber() / 10 ** 6;
    const needUi = totalAmount.toNumber() / 10 ** 6;
    throw new Error(
      `Insufficient tokens to vest. Have ${haveUi.toLocaleString()} tokens, need ${needUi.toLocaleString()}. ` +
      `Increase your initial buy amount to acquire at least ${needUi.toLocaleString()} tokens before launching with vesting.`,
    );
  }

  const result = await client.create(
    {
      // IBaseStreamConfig
      tokenId: mint,
      period,
      start,
      cliff,
      cancelableBySender: true,
      cancelableByRecipient: false,
      transferableBySender: false,
      transferableByRecipient: true,
      canTopup: false,
      // IRecipient
      recipient,
      amount: totalAmount,
      name: `${tokenName} Vesting`,
      cliffAmount: adjustedCliffAmount,
      amountPerPeriod,
    },
    {
      sender: wallet,
      isNative: false,
    },
  );

  const { txId, metadataId } = result;

  console.log('[Streamflow] stream created:', { txId, streamId: metadataId });

  return {
    streamId: metadataId,
    txId,
    dashboardUrl: `${DASHBOARD_BASE}/${metadataId}`,
  };
}
