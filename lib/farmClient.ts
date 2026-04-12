import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import farmsIdl from './farms-idl.json';

export const FARM_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_FARM_PROGRAM_ID ?? '3tC6fGzkF5xpK1paLMvcGQV2WpY2QEYzdMPSGAogbjzg'
);

// Farm contract lives on devnet
export const FARM_RPC = 'https://api.devnet.solana.com';

export const PRECISION = new BN('1000000000000'); // 1e12

export interface FarmStateData {
  authority: PublicKey;
  stakeMint: PublicKey;
  rewardMint: PublicKey;
  rewardRate: BN;
  totalStaked: BN;
  rewardPerTokenStored: BN;
  lastUpdateTime: BN;
  minStakeDuration: BN;
  bump: number;
  vaultBump: number;
  rewardVaultBump: number;
}

export interface StakePositionData {
  owner: PublicKey;
  farm: PublicKey;
  amount: BN;
  rewardPerTokenPaid: BN;
  rewardsEarned: BN;
  stakeTime: BN;
  bump: number;
}

export interface FarmAccount {
  publicKey: PublicKey;
  account: FarmStateData;
}

export type AnchorWallet = {
  publicKey: PublicKey;
  signTransaction: (tx: unknown) => Promise<unknown>;
  signAllTransactions: (txs: unknown[]) => Promise<unknown[]>;
};

// ─── PDA derivation ────────────────────────────────────────────────────────

export function deriveFarmPDA(stakeMint: PublicKey, authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('farm'), stakeMint.toBuffer(), authority.toBuffer()],
    FARM_PROGRAM_ID
  );
}

export function deriveStakeVaultPDA(farmState: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), farmState.toBuffer()],
    FARM_PROGRAM_ID
  );
}

export function deriveRewardVaultPDA(farmState: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('reward_vault'), farmState.toBuffer()],
    FARM_PROGRAM_ID
  );
}

export function deriveStakePositionPDA(farmState: PublicKey, user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stake'), farmState.toBuffer(), user.toBuffer()],
    FARM_PROGRAM_ID
  );
}

// ─── Provider helpers ───────────────────────────────────────────────────────

function readonlyProvider(): AnchorProvider {
  const connection = new Connection(FARM_RPC, 'confirmed');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dummyWallet: any = {
    publicKey: PublicKey.default,
    signTransaction: async <T>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
  };
  return new AnchorProvider(connection, dummyWallet, { commitment: 'confirmed' });
}

export function signingProvider(wallet: AnchorWallet): AnchorProvider {
  const connection = new Connection(FARM_RPC, 'confirmed');
  return new AnchorProvider(connection, wallet as never, { commitment: 'confirmed' });
}

export function getProgram(provider: AnchorProvider): Program {
  return new Program(farmsIdl as never, provider);
}

// ─── Read helpers ───────────────────────────────────────────────────────────

/** Fetch all FarmState accounts whose stake_mint matches the given mint. */
export async function fetchFarmsForMint(mintPubkey: PublicKey): Promise<FarmAccount[]> {
  try {
    const program = getProgram(readonlyProvider());
    // stake_mint is at byte offset 40: 8 (disc) + 32 (authority)
    const farms = await (program.account as unknown as Record<string, { all: (filters: unknown[]) => Promise<Array<{ publicKey: PublicKey; account: FarmStateData }>> }>).farmState.all([
      { memcmp: { offset: 40, bytes: mintPubkey.toBase58() } },
    ]);
    return farms;
  } catch {
    return [];
  }
}

/** Fetch a single user stake position, or null if not yet created. */
export async function fetchStakePosition(
  farmState: PublicKey,
  user: PublicKey
): Promise<StakePositionData | null> {
  try {
    const [positionPDA] = deriveStakePositionPDA(farmState, user);
    const program = getProgram(readonlyProvider());
    const pos = await (program.account as unknown as Record<string, { fetch: (pk: PublicKey) => Promise<StakePositionData> }>).stakePosition.fetch(positionPDA);
    return pos;
  } catch {
    return null;
  }
}

/** Returns the human-readable token balance in the reward vault (e.g. "123.4567"). */
export async function fetchRewardVaultBalance(farmState: PublicKey): Promise<number> {
  try {
    const connection = new Connection(FARM_RPC, 'confirmed');
    const [rewardVault] = deriveRewardVaultPDA(farmState);
    const info = await connection.getTokenAccountBalance(rewardVault);
    return Number(info.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

/** Returns the human-readable token balance for the user's ATA of the given mint. */
export async function fetchUserTokenBalance(mint: PublicKey, user: PublicKey): Promise<number> {
  try {
    const connection = new Connection(FARM_RPC, 'confirmed');
    const ata = getAssociatedTokenAddressSync(mint, user);
    const info = await connection.getTokenAccountBalance(ata);
    return Number(info.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

// ─── Client-side reward estimate ────────────────────────────────────────────

/**
 * Mirrors the on-chain reward accumulator math to give a real-time estimate
 * of pending rewards without sending a transaction.
 */
export function computePendingRewards(
  farm: FarmStateData,
  position: StakePositionData,
  nowSecs: number = Math.floor(Date.now() / 1000)
): BN {
  if (position.amount.isZero() || farm.totalStaked.isZero()) {
    return position.rewardsEarned;
  }
  const elapsed = new BN(nowSecs).sub(farm.lastUpdateTime);
  if (elapsed.isNeg() || elapsed.isZero()) return position.rewardsEarned;

  // rewardPerToken = stored + elapsed * rate * PRECISION / totalStaked
  const additionalPerToken = elapsed
    .mul(farm.rewardRate)
    .mul(PRECISION)
    .div(farm.totalStaked);
  const currentRewardPerToken = farm.rewardPerTokenStored.add(additionalPerToken);

  // pendingNew = (currentRewardPerToken - paid) * amount / PRECISION
  const diff = currentRewardPerToken.sub(position.rewardPerTokenPaid);
  const pendingNew = diff.lte(new BN(0))
    ? new BN(0)
    : diff.mul(position.amount).div(PRECISION);

  return position.rewardsEarned.add(pendingNew);
}

// ─── Instructions ───────────────────────────────────────────────────────────

export async function createFarm(
  wallet: AnchorWallet,
  stakeMint: PublicKey,
  rewardRatePerSecond: BN,
  minStakeDurationSecs: BN
): Promise<string> {
  const provider = signingProvider(wallet);
  const program = getProgram(provider);
  const [farmState] = deriveFarmPDA(stakeMint, wallet.publicKey);
  const [stakeVault] = deriveStakeVaultPDA(farmState);
  const [rewardVault] = deriveRewardVaultPDA(farmState);

  return (program.methods as never as {
    initializeFarm: (rate: BN, dur: BN) => {
      accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
    };
  }).initializeFarm(rewardRatePerSecond, minStakeDurationSecs)
    .accounts({
      farmState,
      stakeVault,
      rewardVault,
      stakeMint,
      rewardMint: stakeMint, // single-sided: same mint
      authority: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function stakeFarm(
  wallet: AnchorWallet,
  farmState: PublicKey,
  stakeMint: PublicKey,
  amount: BN
): Promise<string> {
  const provider = signingProvider(wallet);
  const program = getProgram(provider);
  const [stakeVault] = deriveStakeVaultPDA(farmState);
  const [stakePosition] = deriveStakePositionPDA(farmState, wallet.publicKey);
  const userStakeAccount = getAssociatedTokenAddressSync(stakeMint, wallet.publicKey);

  return (program.methods as never as {
    stake: (amt: BN) => {
      accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
    };
  }).stake(amount)
    .accounts({
      farmState,
      stakePosition,
      stakeVault,
      userStakeAccount,
      user: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function unstakeFarm(
  wallet: AnchorWallet,
  farmState: PublicKey,
  stakeMint: PublicKey,
  amount: BN
): Promise<string> {
  const provider = signingProvider(wallet);
  const program = getProgram(provider);
  const [stakeVault] = deriveStakeVaultPDA(farmState);
  const [stakePosition] = deriveStakePositionPDA(farmState, wallet.publicKey);
  const userStakeAccount = getAssociatedTokenAddressSync(stakeMint, wallet.publicKey);

  return (program.methods as never as {
    unstake: (amt: BN) => {
      accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
    };
  }).unstake(amount)
    .accounts({
      farmState,
      stakePosition,
      stakeVault,
      userStakeAccount,
      user: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

export async function claimRewardsFarm(
  wallet: AnchorWallet,
  farmState: PublicKey,
  rewardMint: PublicKey
): Promise<string> {
  const provider = signingProvider(wallet);
  const program = getProgram(provider);
  const [rewardVault] = deriveRewardVaultPDA(farmState);
  const [stakePosition] = deriveStakePositionPDA(farmState, wallet.publicKey);
  const userRewardAccount = getAssociatedTokenAddressSync(rewardMint, wallet.publicKey);

  return (program.methods as never as {
    claimRewards: () => {
      accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> };
    };
  }).claimRewards()
    .accounts({
      farmState,
      stakePosition,
      rewardVault,
      userRewardAccount,
      user: wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}
