@AGENTS.md

## RAYDIUM LAUNCHLAB DOCS

Fetched from docs.raydium.io on 2026-04-11. Permanent SDK reference for all BASEDFARMS Raydium development.

Source pages:
- https://docs.raydium.io/raydium/build/developer-guides/index
- https://docs.raydium.io/raydium/build/developer-guides/index/launching-a-token
- https://docs.raydium.io/raydium/build/developer-guides/index/buying-and-selling-a-token
- https://docs.raydium.io/raydium/build/developer-guides/index/creating-a-platform
- https://docs.raydium.io/raydium/build/developer-guides/index/collecting-fees
- https://docs.raydium.io/raydium/build/developer-guides/index/monitoring-token-migration
- GitHub demo: https://github.com/raydium-io/raydium-sdk-V2-demo/tree/master/src/launchpad

---

### Program IDs

| Network | Address |
|---------|---------|
| Mainnet | `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` (via `LAUNCHPAD_PROGRAM`) |
| Devnet  | `DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6` (via `DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM`) |

Related program constants:
- `LOCK_CPMM_PROGRAM` — locks LP tokens post-migration
- `LOCK_CPMM_AUTH` — authority for the lock CPMM program
- `NATIVE_MINT` — WSOL mint (currently the only supported `mintB` for LaunchLab pools)

---

### Installation

```bash
yarn add @raydium-io/raydium-sdk-v2
```

Key imports:
```typescript
import {
  Raydium,
  TxVersion,
  LAUNCHPAD_PROGRAM,
  DEVNET_PROGRAM_ID,
  getPdaLaunchpadConfigId,
  getPdaLaunchpadPoolId,
  getPdaPlatformId,
  LaunchpadConfig,
  PlatformConfig,
  CpmmCreatorFeeOn,
  Curve,
  LOCK_CPMM_PROGRAM,
  LOCK_CPMM_AUTH,
  updatePlatformCurveParamInstruction,
} from '@raydium-io/raydium-sdk-v2'
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey, Keypair } from '@solana/web3.js'
import BN from 'bn.js'
```

---

### Pool Lifecycle States

```
0 = Trading   (bonding curve active — buy/sell enabled)
1 = Migrate   (migration in progress — trading paused)
2 = Migrated  (live on CPMM or AMM — LP fees claimable)
```

Migration triggers automatically when `totalFundRaisingB` worth of SOL is raised.
Check status: `await raydium.launchpad.getRpcPoolInfo({ poolId })`

---

### PDA Derivation Helpers

```typescript
// Config PDA — use NATIVE_MINT, curveType=0, index=0 for standard SOL pool
const { publicKey: configId } = getPdaLaunchpadConfigId(
  LAUNCHPAD_PROGRAM,
  NATIVE_MINT,
  0,   // curveType (0 = constant product)
  0    // index
)

// Pool PDA — derived from mintA + mintB (WSOL)
const { publicKey: poolId } = getPdaLaunchpadPoolId(
  LAUNCHPAD_PROGRAM,
  mintA,
  NATIVE_MINT
)

// Platform PDA — derived from admin wallet
const { publicKey: platformId } = getPdaPlatformId(
  LAUNCHPAD_PROGRAM,
  adminWalletPublicKey
)
```

---

### createLaunchpad() ✅ (implemented in services/launch.ts)

Deploys a new SPL token and initialises the bonding-curve pool.

```typescript
const { execute, extInfo } = await raydium.launchpad.createLaunchpad({
  programId: LAUNCHPAD_PROGRAM,
  mintA: tokenKeypair.publicKey,      // freshly generated Keypair
  decimals: 6,                         // 6 or 9; 6 is most common
  name: 'My Token',
  symbol: 'MTK',
  uri: 'https://arweave.net/metadata.json',

  // Optional: if platform has been created (BASEDFARMS skips this for now)
  // platformId: new PublicKey('your-platform-id'),

  configId,                            // from getPdaLaunchpadConfigId()
  migrateType: 'cpmm',                 // 'cpmm' | 'amm'

  // Supply — all in raw units (include decimals)
  supply: new BN('1000000000000000'),        // 1B tokens × 10^6
  totalSellA: new BN('793100000000000'),     // ≥ 20% of supply
  totalFundRaisingB: new BN('85000000000'),  // 85 SOL in lamports
  totalLockedAmount: new BN('0'),            // vesting reserve ≤ 30% supply

  // Vesting (only relevant when totalLockedAmount > 0)
  cliffPeriod: new BN('0'),           // seconds
  unlockPeriod: new BN('0'),          // seconds

  // Initial buy — set createOnly: true + buyAmount: 0 to skip
  createOnly: true,
  buyAmount: new BN('0'),
  slippage: new BN(100),              // basis points; 100 = 1%
  minMintAAmount: new BN('0'),        // min tokens out on initial buy

  creatorFeeOn: CpmmCreatorFeeOn.OnlyTokenB,  // or CpmmCreatorFeeOn.BothToken

  // BASEDFARMS referral share
  shareFeeRate: new BN(30),           // 30 bps = 0.3%
  shareFeeReceiver: treasuryPublicKey,

  // Token-2022 transfer fee (omit if not using Token-2022)
  transferFeeExtensionParams: {
    transferFeeBasePoints: 100,        // bps
    maxinumFee: new BN('1000000'),     // raw units (note: typo in SDK — "maxinum")
  },

  extraSigners: [tokenKeypair],        // REQUIRED — mint keypair must co-sign
  txVersion: TxVersion.V0,            // or TxVersion.LEGACY
  computeBudgetConfig: { units: 800_000, microLamports: 150_000 },
})

// Result
const poolId = extInfo.address.poolId.toBase58()
const mintAddress = tokenKeypair.publicKey.toBase58()
// execute returns { txIds } (array — can be multiple txs)
const { txIds } = await execute({ sendAndConfirm: true, sequentially: true })
```

**Supply formula:** `supply = totalSellA + totalLockedAmount + migrateAmount`
- `totalSellA` must be ≥ 20% of supply
- `totalLockedAmount` must be ≤ 30% of supply
- Minimum supply: 10,000,000 pre-decimals

**CpmmCreatorFeeOn enum:**
- `CpmmCreatorFeeOn.OnlyTokenB` — fees in SOL only (recommended; no sell pressure)
- `CpmmCreatorFeeOn.BothToken` — fees in both token and SOL

---

### createVesting()

Allocates a share of the pool's locked tokens to a beneficiary. Must be called after `createLaunchpad()` and `shareAmount` must not exceed the pool's `totalLockedAmount`.

```typescript
const { execute } = await raydium.launchpad.createVesting({
  // programId: DEVNET_PROGRAM_ID.LAUNCHPAD_PROGRAM, // devnet only
  poolId: new PublicKey('pool-id'),
  beneficiary: new PublicKey('recipient-wallet'),
  shareAmount: new BN(100000),    // raw token units; must ≤ pool totalLockedAmount
  txVersion: TxVersion.V0,
  // computeBudgetConfig: { units: 600000, microLamports: 600000 },
})
const sentInfo = await execute({ sendAndConfirm: true })
```

---

### createPlatformConfig() — IMPORTANT for BASEDFARMS fees

Creates a platform entry so BASEDFARMS earns a % of every pool's trading fees. The `platformId` returned here is passed as `platformId` to `createLaunchpad()`.

```typescript
const { execute, extInfo } = await raydium.launchpad.createPlatformConfig({
  programId: LAUNCHPAD_PROGRAM,
  platformAdmin: adminWallet,              // controls platform settings
  platformClaimFeeWallet: feeWallet,       // receives trading fees (SOL)
  platformLockNftWallet: nftWallet,        // receives Fee Key NFT post-migration
  platformVestingWallet: vestingWallet,    // for vesting allocations

  // CPMM fee tier — fetch from api-v3.raydium.io/main/cpmm-config
  cpConfigId: new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8'),

  transferFeeExtensionAuth: adminWallet,   // Token-2022 authority recipient

  // Fees in basis points × 100 (so 10000 = 1%, 50000 = 5%)
  feeRate: new BN(10000),           // platform fee rate (1%)
  creatorFeeRate: new BN(5000),     // max creator fee rate (0.5%); max is 50000 = 5%

  // LP distribution — must sum to exactly 1,000,000
  migrateCpLockNftScale: {
    platformScale: new BN(100000),  // 10% LP to platform
    creatorScale: new BN(100000),   // 10% LP to creator
    burnScale: new BN(800000),      // 80% LP burned permanently
  },

  // Platform metadata
  name: 'BASEDFARMS',
  web: 'https://basedfarms.com',
  img: 'https://basedfarms.com/logo.png',

  txVersion: TxVersion.V0,
})

const { txId } = await execute({ sendAndConfirm: true })
const platformId = extInfo.platformId.toBase58()
// Store platformId — pass it to every createLaunchpad() call
```

---

### updatePlatformConfig()

Modify platform settings. Can only be called once per epoch.

```typescript
const { execute } = await raydium.launchpad.updatePlatformConfig({
  platformAdmin: adminWallet,
  updateInfo: {
    type: 'updateFeeRate',          // see update types below
    value: new BN(15000),
  },
  txVersion: TxVersion.V0,
})
await execute({ sendAndConfirm: true })
```

**Update types:**
| `type` | `value` type | Description |
|--------|-------------|-------------|
| `updateFeeRate` | `BN` | Platform fee rate in bps×100 |
| `updateClaimFeeWallet` | `PublicKey` | New fee claim destination |
| `updateLockNftWallet` | `PublicKey` | New NFT receive wallet |
| `updateVestingWallet` | `PublicKey` | New vesting wallet |
| `updateCpConfigId` | `PublicKey` | CPMM fee tier |
| `migrateCpLockNftScale` | object `{ platformScale, creatorScale, burnScale }` | LP split |
| `updateAll` | object | Update multiple fields at once |

---

### updatePlatformCurveParamInstruction()

Enforces allowed token configurations (up to 25, stored at indices 0–254). Adds a raw instruction; compose into your own transaction.

```typescript
import { updatePlatformCurveParamInstruction } from '@raydium-io/raydium-sdk-v2'

const ix = updatePlatformCurveParamInstruction(
  LAUNCHPAD_PROGRAM,
  platformAdmin,    // PublicKey
  platformId,       // PublicKey
  1,                // index (0–254)
  {
    migrateType: 1,                              // 0=amm, 1=cpmm
    migrateCpmmFeeOn: 0,                         // 0=off
    supply: new BN('1000000000000000'),
    totalSellA: new BN('793100000000000'),
    totalFundRaisingB: new BN('85000000000'),
    totalLockedAmount: new BN('0'),
    cliffPeriod: new BN('0'),
    unlockPeriod: new BN('0'),
  }
)
```

---

### buyToken() ✅

```typescript
const { execute, extInfo } = await raydium.launchpad.buyToken({
  mintA: new PublicKey('token-mint'),
  buyAmount: new BN(1_000_000_000),   // SOL lamports to spend
  slippage: new BN(100),              // 100 bps = 1%
  txVersion: TxVersion.V0,
  // Optional for referral:
  // shareFeeRate: new BN(30),
  // shareFeeReceiver: treasuryPublicKey,
})
const { txId } = await execute({ sendAndConfirm: true })
// extInfo.decimalOutAmount — tokens received (decimal)
```

### buyTokenExactOut()

Buy an exact number of tokens; specify max SOL willing to spend.

```typescript
const { execute, extInfo } = await raydium.launchpad.buyTokenExactOut({
  programId: LAUNCHPAD_PROGRAM,
  mintA,
  poolInfo,
  outAmount: new BN('1000000000000'),   // exact tokens desired
  maxBuyAmount: new BN('2000000000'),   // max SOL to spend
  slippage: new BN(100),
  txVersion: TxVersion.V0,
})
```

---

### sellToken() ✅

```typescript
const { execute, extInfo } = await raydium.launchpad.sellToken({
  programId: LAUNCHPAD_PROGRAM,
  mintA,
  sellAmount: new BN('1000000000000'), // token raw units to sell
  slippage: new BN(100),
  txVersion: TxVersion.V0,
})
// extInfo.outAmount — SOL received
```

### sellTokenExactOut()

Sell tokens to receive an exact SOL amount; specify max tokens willing to sell.

```typescript
const { execute } = await raydium.launchpad.sellTokenExactOut({
  programId: LAUNCHPAD_PROGRAM,
  mintA,
  poolInfo,
  inAmount: new BN('1000000000'),       // exact SOL desired
  maxSellAmount: new BN('600000000000'),// max tokens to sell
  slippage: new BN(100),
  txVersion: TxVersion.V0,
})
```

---

### Curve — Static Quote Utilities

Compute expected amounts without sending a transaction.

```typescript
import { Curve } from '@raydium-io/raydium-sdk-v2'

Curve.buyExactIn({ poolInfo, amountB, ... })   // tokens out for given SOL in
Curve.buyExactOut({ poolInfo, ... })           // SOL needed for target token out
Curve.sellExactIn({ poolInfo, amountA, ... })  // SOL out for given token in
Curve.sellExactOut({ poolInfo, ... })          // tokens needed for target SOL out
```

---

### claimVaultPlatformFee() — collecting platform earnings

Claims accumulated platform fees from a single quote-token vault.

```typescript
const { execute } = await raydium.launchpad.claimVaultPlatformFee({
  programId: LAUNCHPAD_PROGRAM,
  platformId: new PublicKey('your-platform-id'),
  claimFeeWallet: adminWallet,   // must be platformClaimFeeWallet set at creation
  mintB: NATIVE_MINT,            // WSOL — currently the only LaunchLab quote token
  // mintBProgram: TOKEN_PROGRAM_ID,
  txVersion: TxVersion.V0,
})
const { txId } = await execute({ sendAndConfirm: true })
```

### claimMultipleVaultPlatformFee()

Claim fees across multiple quote tokens in one call.

```typescript
const { execute } = await raydium.launchpad.claimMultipleVaultPlatformFee({
  platformList: [
    { id: platformId, mintB: NATIVE_MINT },
    { id: platformId, mintB: new PublicKey('USDC-mint') },
  ],
  unwrapSol: true,   // auto-unwrap WSOL → SOL
  txVersion: TxVersion.V0,
})
const { txIds } = await execute({ sendAndConfirm: true, sequentially: true })
```

### claimCreatorFee()

Claim bonding-curve trading fees earned as token creator (pre-migration).

```typescript
const { execute } = await raydium.launchpad.claimCreatorFee({
  programId: LAUNCHPAD_PROGRAM,
  mintB: NATIVE_MINT,
  // mintBProgram: TOKEN_PROGRAM_ID,
  txVersion: TxVersion.V0,
})
const { txId } = await execute({ sendAndConfirm: true })
```

### claimMultipleCreatorFee()

```typescript
const { execute } = await raydium.launchpad.claimMultipleCreatorFee({
  mintBList: [
    { pubKey: NATIVE_MINT, programId: TOKEN_PROGRAM_ID },
    { pubKey: new PublicKey('USDC-mint'), programId: TOKEN_PROGRAM_ID },
  ],
  txVersion: TxVersion.V0,
})
const { txIds } = await execute({ sendAndConfirm: true, sequentially: true })
```

---

### harvestLockLp() — post-migration LP fee harvest

After a token graduates to a CPMM pool, LP tokens are locked and a **Fee Key NFT** is issued. Whoever holds the NFT can claim the LP trading fees. **Do not burn the Fee Key NFT — fee rights are permanently lost.**

```typescript
// 1. Find all locked LP positions for the wallet
const lockPositions = await raydium.cpmm.getOwnerLockLpInfo({
  owner: raydium.ownerPubKey,
})

// 2. Harvest fees for each position
for (const position of lockPositions) {
  const { execute } = await raydium.cpmm.harvestLockLp({
    programId: LOCK_CPMM_PROGRAM,
    authProgram: LOCK_CPMM_AUTH,
    lockData: position,
    txVersion: TxVersion.V0,
  })
  await execute({ sendAndConfirm: true })
}
```

### collectCreatorFee() — post-migration CPMM creator fees

```typescript
const pools = await raydium.cpmm.getCreatorPools({
  creator: raydium.ownerPubKey,
})
for (const pool of pools) {
  const { execute } = await raydium.cpmm.collectCreatorFee({
    poolInfo: pool,
    txVersion: TxVersion.V0,
  })
  await execute({ sendAndConfirm: true })
}
```

---

### Pool Info Fetch

```typescript
// Get full on-chain pool state
const poolInfo = await raydium.launchpad.getRpcPoolInfo({ poolId })
// poolInfo.status: 0 (Trading) | 1 (Migrate) | 2 (Migrated)

// Get config (also available at init time to skip network call)
const configAcct = await connection.getAccountInfo(configId, 'processed')
const configInfo = LaunchpadConfig.decode(configAcct.data)

// Decode platform config
const platformAcct = await connection.getAccountInfo(platformId, 'processed')
const platformInfo = PlatformConfig.decode(platformAcct.data)

// Fetch available configs from API
const configs = await raydium.api.fetchLaunchConfigs()
```

---

### Fee Parameters Summary

| Parameter | Units | Description |
|-----------|-------|-------------|
| `feeRate` | bps × 100 | Platform trading fee (10000 = 1%) |
| `creatorFeeRate` | bps × 100 | Creator trading fee (max 50000 = 5%) |
| `shareFeeRate` | BN bps | Referral share fee (30 = 0.3%) |
| `slippage` | bps | Swap slippage tolerance (100 = 1%) |
| `platformScale` | / 1,000,000 | Platform LP share (100000 = 10%) |
| `creatorScale` | / 1,000,000 | Creator LP share |
| `burnScale` | / 1,000,000 | Burned LP (platformScale + creatorScale + burnScale = 1,000,000) |

---

### Migration

| `migrateType` | Destination | Fee Key NFT | LP Burn |
|---------------|-------------|-------------|---------|
| `'cpmm'` | Raydium CPMM pool | Yes — enables LP fee claims | Yes |
| `'amm'` | Raydium AMM v4 | No | Yes |

Use `'cpmm'` for all new BASEDFARMS launches (required for `harvestLockLp` and creator fees).

---

### CPMM Config IDs (for cpConfigId in createPlatformConfig)

Fetch current list from:
- Mainnet: `https://api-v3.raydium.io/main/cpmm-config`
- Devnet: `https://api-v3-devnet.raydium.io/main/cpmm-config`

Example known config: `DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8`

---

### SDK Demo Repository

Full working examples: https://github.com/raydium-io/raydium-sdk-V2-demo/tree/master/src/launchpad

Key files:
- `createMint.ts` — basic token creation
- `createPlatform.ts` — platform setup
- `updatePlatform.ts` — platform updates
- `buy.ts` / `sell.ts` — trading
- `createVestingAccount.ts` — vesting setup
- `claimCreatorFee.ts` — creator fee collection
- `claimPlatformFeeFromVault.ts` — platform fee collection
- `claimPlatformFeeAll.ts` — bulk fee collection
- `harvestLockLp` / `collectAllCreatorFees.ts` — post-migration
