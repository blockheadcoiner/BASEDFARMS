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
  const { wallet, recipient, mint, totalAmount, cliffDays, unlockDays, tokenName } = params;

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

  console.log('[Streamflow] createVestingStream', {
    recipient,
    mint,
    totalAmount: totalAmount.toString(),
    start,
    cliff,
    cliffDays,
    unlockDays,
    amountPerPeriod: amountPerPeriod.toString(),
    adjustedCliffAmount: adjustedCliffAmount.toString(),
  });

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
