use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("3tC6fGzkF5xpK1paLMvcGQV2WpY2QEYzdMPSGAogbjzg");

/// Fixed-point precision: 1e12
/// reward_per_token is stored scaled by this factor so integer math keeps
/// sub-lamport precision even at low stake amounts.
const PRECISION: u128 = 1_000_000_000_000;

// ─────────────────────────────────────────────────────────────────────────────
//  State accounts
// ─────────────────────────────────────────────────────────────────────────────

/// Global farm configuration.
/// PDA seeds: ["farm", stake_mint, authority]
#[account]
#[derive(InitSpace)]
pub struct FarmState {
    /// Farm creator / admin.
    pub authority: Pubkey,             // 32
    /// Mint of the token users deposit.
    pub stake_mint: Pubkey,            // 32
    /// Mint of the token paid as rewards (same as stake_mint for single-sided).
    pub reward_mint: Pubkey,           // 32
    /// Raw reward tokens emitted per second across all stakers.
    pub reward_rate: u64,              // 8
    /// Sum of all currently staked token amounts.
    pub total_staked: u64,             // 8
    /// Accumulated reward-per-token (scaled by PRECISION).
    pub reward_per_token_stored: u128, // 16
    /// Unix timestamp of the last accumulator update.
    pub last_update_time: i64,         // 8
    /// Minimum seconds a user must keep tokens staked before unstaking.
    pub min_stake_duration: i64,       // 8
    // PDA bumps cached to avoid recomputation in CPIs.
    pub bump: u8,                      // 1
    pub vault_bump: u8,                // 1
    pub reward_vault_bump: u8,         // 1
}

/// Per-user staking position.
/// PDA seeds: ["stake", farm_state, owner]
#[account]
#[derive(InitSpace)]
pub struct StakePosition {
    pub owner: Pubkey,                 // 32
    pub farm: Pubkey,                  // 32
    /// Current staked token amount.
    pub amount: u64,                   // 8
    /// Snapshot of reward_per_token_stored at the time rewards were last settled.
    pub reward_per_token_paid: u128,   // 16
    /// Accumulated but not-yet-claimed rewards.
    pub rewards_earned: u64,           // 8
    /// Unix timestamp of the user's first (or most recent) stake.
    pub stake_time: i64,               // 8
    pub bump: u8,                      // 1
}

// ─────────────────────────────────────────────────────────────────────────────
//  Errors
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum FarmError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Minimum stake duration not yet met")]
    MinStakeDurationNotMet,
    #[msg("Insufficient staked balance")]
    InsufficientStake,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("No rewards available to claim")]
    NoRewards,
    #[msg("Only the farm authority may call this instruction")]
    Unauthorized,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Events
// ─────────────────────────────────────────────────────────────────────────────

#[event]
pub struct Staked   { pub user: Pubkey, pub farm: Pubkey, pub amount: u64, pub ts: i64 }
#[event]
pub struct Unstaked { pub user: Pubkey, pub farm: Pubkey, pub amount: u64, pub ts: i64 }
#[event]
pub struct Claimed  { pub user: Pubkey, pub farm: Pubkey, pub amount: u64, pub ts: i64 }
#[event]
pub struct Funded   { pub farm: Pubkey, pub amount: u64, pub ts: i64 }

// ─────────────────────────────────────────────────────────────────────────────
//  Internal math helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Advance `reward_per_token_stored` to `now`, then update `last_update_time`.
/// Safe-no-ops when no tokens are staked.
fn update_reward_accumulator(farm: &mut FarmState, now: i64) -> Result<()> {
    if farm.total_staked > 0 {
        let elapsed = now.saturating_sub(farm.last_update_time) as u128;
        let delta = elapsed
            .checked_mul(farm.reward_rate as u128)
            .ok_or(FarmError::Overflow)?
            .checked_mul(PRECISION)
            .ok_or(FarmError::Overflow)?
            .checked_div(farm.total_staked as u128)
            .ok_or(FarmError::Overflow)?;
        farm.reward_per_token_stored = farm
            .reward_per_token_stored
            .checked_add(delta)
            .ok_or(FarmError::Overflow)?;
    }
    farm.last_update_time = now;
    Ok(())
}

/// Calculate tokens earned by `position` since its last snapshot.
fn calc_pending(position: &StakePosition, rpt_stored: u128) -> u64 {
    let delta = rpt_stored.saturating_sub(position.reward_per_token_paid);
    ((position.amount as u128).saturating_mul(delta) / PRECISION) as u64
}

// ─────────────────────────────────────────────────────────────────────────────
//  Program
// ─────────────────────────────────────────────────────────────────────────────

#[program]
pub mod farms {
    use super::*;

    // ── 1. initialize_farm ─────────────────────────────────────────────────

    /// One-time setup.  Creates the farm state account and both token vaults.
    /// For single-sided staking pass the same pubkey for `stake_mint` and
    /// `reward_mint`.
    pub fn initialize_farm(
        ctx: Context<InitializeFarm>,
        reward_rate_per_second: u64,
        min_stake_duration: i64,
    ) -> Result<()> {
        let farm = &mut ctx.accounts.farm_state;
        farm.authority               = ctx.accounts.authority.key();
        farm.stake_mint              = ctx.accounts.stake_mint.key();
        farm.reward_mint             = ctx.accounts.reward_mint.key();
        farm.reward_rate             = reward_rate_per_second;
        farm.total_staked            = 0;
        farm.reward_per_token_stored = 0;
        farm.last_update_time        = Clock::get()?.unix_timestamp;
        farm.min_stake_duration      = min_stake_duration;
        farm.bump                    = ctx.bumps.farm_state;
        farm.vault_bump              = ctx.bumps.stake_vault;
        farm.reward_vault_bump       = ctx.bumps.reward_vault;
        Ok(())
    }

    // ── 2. stake ───────────────────────────────────────────────────────────

    /// Deposit `amount` tokens.  Creates the StakePosition on first call.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, FarmError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;

        update_reward_accumulator(&mut ctx.accounts.farm_state, now)?;

        // Settle any pending rewards before the balance changes.
        {
            let rpt = ctx.accounts.farm_state.reward_per_token_stored;
            let pos = &mut ctx.accounts.stake_position;
            if pos.amount > 0 {
                let pending = calc_pending(pos, rpt);
                pos.rewards_earned = pos
                    .rewards_earned
                    .checked_add(pending)
                    .ok_or(FarmError::Overflow)?;
            }
        }

        // Transfer: user token account → stake vault.
        token::transfer(
            CpiContext::new(
                anchor_spl::token::ID,
                Transfer {
                    from:      ctx.accounts.user_stake_account.to_account_info(),
                    to:        ctx.accounts.stake_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // Initialise position fields on first stake.
        let pos = &mut ctx.accounts.stake_position;
        if pos.owner == Pubkey::default() {
            pos.owner      = ctx.accounts.user.key();
            pos.farm       = ctx.accounts.farm_state.key();
            pos.stake_time = now;
            pos.bump       = ctx.bumps.stake_position;
        }
        pos.amount = pos.amount.checked_add(amount).ok_or(FarmError::Overflow)?;
        pos.reward_per_token_paid = ctx.accounts.farm_state.reward_per_token_stored;

        ctx.accounts.farm_state.total_staked = ctx
            .accounts
            .farm_state
            .total_staked
            .checked_add(amount)
            .ok_or(FarmError::Overflow)?;

        let farm_key = ctx.accounts.farm_state.key();
        emit!(Staked { user: ctx.accounts.user.key(), farm: farm_key, amount, ts: now });
        Ok(())
    }

    // ── 3. unstake ─────────────────────────────────────────────────────────

    /// Withdraw `amount` tokens.  Settles pending rewards into the position
    /// without transferring them (call `claim_rewards` separately).
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        require!(amount > 0, FarmError::ZeroAmount);
        let now = Clock::get()?.unix_timestamp;

        // Lock-duration and balance checks (immutable borrows first).
        let (stake_time, min_dur, pos_amount) = {
            let farm = &ctx.accounts.farm_state;
            let pos  = &ctx.accounts.stake_position;
            (pos.stake_time, farm.min_stake_duration, pos.amount)
        };
        require!(
            now - stake_time >= min_dur,
            FarmError::MinStakeDurationNotMet
        );
        require!(pos_amount >= amount, FarmError::InsufficientStake);

        update_reward_accumulator(&mut ctx.accounts.farm_state, now)?;

        // Settle rewards.
        {
            let rpt = ctx.accounts.farm_state.reward_per_token_stored;
            let pos = &mut ctx.accounts.stake_position;
            let p   = calc_pending(pos, rpt);
            pos.rewards_earned = pos.rewards_earned.checked_add(p).ok_or(FarmError::Overflow)?;
            pos.reward_per_token_paid = rpt;
            pos.amount = pos.amount.checked_sub(amount).ok_or(FarmError::Overflow)?;
        }

        ctx.accounts.farm_state.total_staked = ctx
            .accounts
            .farm_state
            .total_staked
            .checked_sub(amount)
            .ok_or(FarmError::Overflow)?;

        // Transfer: stake vault → user  (farm_state PDA signs).
        {
            let farm = &ctx.accounts.farm_state;
            let seeds: &[&[&[u8]]] = &[&[
                b"farm",
                farm.stake_mint.as_ref(),
                farm.authority.as_ref(),
                &[farm.bump],
            ]];
            token::transfer(
                CpiContext::new_with_signer(
                    anchor_spl::token::ID,
                    Transfer {
                        from:      ctx.accounts.stake_vault.to_account_info(),
                        to:        ctx.accounts.user_stake_account.to_account_info(),
                        authority: ctx.accounts.farm_state.to_account_info(),
                    },
                    seeds,
                ),
                amount,
            )?;
        }

        let farm_key = ctx.accounts.farm_state.key();
        emit!(Unstaked { user: ctx.accounts.user.key(), farm: farm_key, amount, ts: now });
        Ok(())
    }

    // ── 4. claim_rewards ───────────────────────────────────────────────────

    /// Transfer all accrued rewards to the user.
    pub fn claim_rewards(ctx: Context<ClaimRewards>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        update_reward_accumulator(&mut ctx.accounts.farm_state, now)?;

        // Compute claimable amount and zero out the position.
        let claimable = {
            let rpt = ctx.accounts.farm_state.reward_per_token_stored;
            let pos = &mut ctx.accounts.stake_position;
            let pending = calc_pending(pos, rpt);
            let total = pos.rewards_earned.checked_add(pending).ok_or(FarmError::Overflow)?;
            pos.rewards_earned        = 0;
            pos.reward_per_token_paid = rpt;
            total
        };
        require!(claimable > 0, FarmError::NoRewards);

        // Transfer: reward vault → user  (farm_state PDA signs).
        {
            let farm = &ctx.accounts.farm_state;
            let seeds: &[&[&[u8]]] = &[&[
                b"farm",
                farm.stake_mint.as_ref(),
                farm.authority.as_ref(),
                &[farm.bump],
            ]];
            token::transfer(
                CpiContext::new_with_signer(
                    anchor_spl::token::ID,
                    Transfer {
                        from:      ctx.accounts.reward_vault.to_account_info(),
                        to:        ctx.accounts.user_reward_account.to_account_info(),
                        authority: ctx.accounts.farm_state.to_account_info(),
                    },
                    seeds,
                ),
                claimable,
            )?;
        }

        let farm_key = ctx.accounts.farm_state.key();
        emit!(Claimed { user: ctx.accounts.user.key(), farm: farm_key, amount: claimable, ts: now });
        Ok(())
    }

    // ── 5. fund_rewards ────────────────────────────────────────────────────

    /// Farm authority deposits reward tokens into the reward vault.
    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        require!(amount > 0, FarmError::ZeroAmount);

        token::transfer(
            CpiContext::new(
                anchor_spl::token::ID,
                Transfer {
                    from:      ctx.accounts.authority_reward_account.to_account_info(),
                    to:        ctx.accounts.reward_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        let farm_key = ctx.accounts.farm_state.key();
        emit!(Funded { farm: farm_key, amount, ts: Clock::get()?.unix_timestamp });
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Account contexts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeFarm<'info> {
    /// Farm state PDA — seeds: ["farm", stake_mint, authority]
    #[account(
        init,
        payer  = authority,
        space  = 8 + FarmState::INIT_SPACE,
        seeds  = [b"farm", stake_mint.key().as_ref(), authority.key().as_ref()],
        bump,
    )]
    pub farm_state: Account<'info, FarmState>,

    /// Vault holding staked tokens — seeds: ["vault", farm_state]
    #[account(
        init,
        payer            = authority,
        token::mint      = stake_mint,
        token::authority = farm_state,
        seeds            = [b"vault", farm_state.key().as_ref()],
        bump,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    /// Vault from which rewards are distributed — seeds: ["reward_vault", farm_state]
    #[account(
        init,
        payer            = authority,
        token::mint      = reward_mint,
        token::authority = farm_state,
        seeds            = [b"reward_vault", farm_state.key().as_ref()],
        bump,
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    pub stake_mint:  Account<'info, Mint>,
    pub reward_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [b"farm", farm_state.stake_mint.as_ref(), farm_state.authority.as_ref()],
        bump  = farm_state.bump,
    )]
    pub farm_state: Account<'info, FarmState>,

    /// Created on the user's first stake, reused on subsequent top-ups.
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + StakePosition::INIT_SPACE,
        seeds = [b"stake", farm_state.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub stake_position: Account<'info, StakePosition>,

    #[account(
        mut,
        seeds            = [b"vault", farm_state.key().as_ref()],
        bump             = farm_state.vault_bump,
        token::mint      = farm_state.stake_mint,
        token::authority = farm_state,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    /// User's source token account (must hold stake_mint tokens).
    #[account(
        mut,
        token::mint      = farm_state.stake_mint,
        token::authority = user,
    )]
    pub user_stake_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        mut,
        seeds = [b"farm", farm_state.stake_mint.as_ref(), farm_state.authority.as_ref()],
        bump  = farm_state.bump,
    )]
    pub farm_state: Account<'info, FarmState>,

    #[account(
        mut,
        seeds      = [b"stake", farm_state.key().as_ref(), user.key().as_ref()],
        bump       = stake_position.bump,
        constraint = stake_position.owner == user.key() @ FarmError::Unauthorized,
    )]
    pub stake_position: Account<'info, StakePosition>,

    #[account(
        mut,
        seeds            = [b"vault", farm_state.key().as_ref()],
        bump             = farm_state.vault_bump,
        token::mint      = farm_state.stake_mint,
        token::authority = farm_state,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint      = farm_state.stake_mint,
        token::authority = user,
    )]
    pub user_stake_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(
        mut,
        seeds = [b"farm", farm_state.stake_mint.as_ref(), farm_state.authority.as_ref()],
        bump  = farm_state.bump,
    )]
    pub farm_state: Account<'info, FarmState>,

    #[account(
        mut,
        seeds      = [b"stake", farm_state.key().as_ref(), user.key().as_ref()],
        bump       = stake_position.bump,
        constraint = stake_position.owner == user.key() @ FarmError::Unauthorized,
    )]
    pub stake_position: Account<'info, StakePosition>,

    #[account(
        mut,
        seeds            = [b"reward_vault", farm_state.key().as_ref()],
        bump             = farm_state.reward_vault_bump,
        token::mint      = farm_state.reward_mint,
        token::authority = farm_state,
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint      = farm_state.reward_mint,
        token::authority = user,
    )]
    pub user_reward_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(
        seeds     = [b"farm", farm_state.stake_mint.as_ref(), farm_state.authority.as_ref()],
        bump      = farm_state.bump,
        has_one   = authority @ FarmError::Unauthorized,
    )]
    pub farm_state: Account<'info, FarmState>,

    #[account(
        mut,
        seeds            = [b"reward_vault", farm_state.key().as_ref()],
        bump             = farm_state.reward_vault_bump,
        token::mint      = farm_state.reward_mint,
        token::authority = farm_state,
    )]
    pub reward_vault: Account<'info, TokenAccount>,

    /// Authority's token account that funds are drawn from.
    #[account(
        mut,
        token::mint      = farm_state.reward_mint,
        token::authority = authority,
    )]
    pub authority_reward_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Unit tests  (pure math — no SVM needed)
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Simulate the accumulator update and verify the math directly.
    fn compute_rpt_delta(reward_rate: u64, total_staked: u64, elapsed_secs: u64) -> u128 {
        (elapsed_secs as u128)
            .checked_mul(reward_rate as u128).unwrap()
            .checked_mul(PRECISION).unwrap()
            .checked_div(total_staked as u128).unwrap()
    }

    fn user_earned(stake: u64, rpt_delta: u128) -> u64 {
        ((stake as u128).saturating_mul(rpt_delta) / PRECISION) as u64
    }

    // ── Reward accumulator ────────────────────────────────────────────────

    #[test]
    fn test_rpt_single_user_full_pool() {
        // 1 user holds 100% of the pool.
        // rate=1_000/s, staked=1_000_000, elapsed=100s
        // total reward = 100_000
        // per-token = 100_000 / 1_000_000 = 0.1
        let rate     = 1_000u64;
        let staked   = 1_000_000u64;
        let elapsed  = 100u64;

        let rpt_delta = compute_rpt_delta(rate, staked, elapsed);
        let earned    = user_earned(staked, rpt_delta); // 100% share

        // reward_rate × elapsed = 100_000 tokens distributed
        assert_eq!(earned, 100_000u64, "single holder should earn all rewards");
    }

    #[test]
    fn test_rpt_two_equal_stakers() {
        let rate    = 1_000u64;
        let total   = 2_000_000u64;    // two users × 1_000_000 each
        let elapsed = 100u64;

        let rpt_delta   = compute_rpt_delta(rate, total, elapsed);
        let each_earned = user_earned(1_000_000u64, rpt_delta);

        // total reward = 100_000, each gets half = 50_000
        assert_eq!(each_earned, 50_000u64, "50/50 split should earn equal rewards");
    }

    #[test]
    fn test_rpt_proportional_shares() {
        let rate    = 10_000u64;
        let total   = 1_000_000u64;
        let elapsed = 50u64;

        let rpt_delta = compute_rpt_delta(rate, total, elapsed);

        let earned_20pct = user_earned(200_000u64, rpt_delta); //  20% share
        let earned_80pct = user_earned(800_000u64, rpt_delta); //  80% share

        // total = 500_000; 20% = 100_000; 80% = 400_000
        assert_eq!(earned_20pct,  100_000u64);
        assert_eq!(earned_80pct,  400_000u64);
        assert_eq!(earned_20pct + earned_80pct, 500_000u64, "shares must sum to total");
    }

    // ── Incremental accumulation ──────────────────────────────────────────

    #[test]
    fn test_incremental_accumulation_equals_bulk() {
        // Accumulating in two 50-second windows should equal one 100-second window.
        let rate   = 2_000u64;
        let staked = 1_000_000u64;

        let bulk  = compute_rpt_delta(rate, staked, 100);
        let half1 = compute_rpt_delta(rate, staked, 50);
        let half2 = compute_rpt_delta(rate, staked, 50);

        assert_eq!(half1 + half2, bulk, "incremental must equal bulk");
    }

    // ── Pending-rewards helper ────────────────────────────────────────────

    #[test]
    fn test_calc_pending_catchup() {
        // Position was last settled at rpt=0.  Current rpt has advanced.
        let mut pos = StakePosition {
            owner:                 Pubkey::default(),
            farm:                  Pubkey::default(),
            amount:                500_000,
            reward_per_token_paid: 0,
            rewards_earned:        0,
            stake_time:            0,
            bump:                  0,
        };

        let rpt_stored = compute_rpt_delta(1_000, 1_000_000, 200); // 200-sec window, full pool

        let pending = calc_pending(&pos, rpt_stored);
        // 500_000 / 1_000_000 × 200_000 = 100_000
        assert_eq!(pending, 100_000u64);

        // After "claiming", rewards_earned and paid should reset correctly.
        pos.reward_per_token_paid = rpt_stored;
        pos.rewards_earned = 0;
        assert_eq!(calc_pending(&pos, rpt_stored), 0, "no double-claim");
    }

    // ── Edge cases ────────────────────────────────────────────────────────

    #[test]
    fn test_zero_elapsed_produces_no_rewards() {
        let rpt = compute_rpt_delta(1_000, 1_000_000, 0);
        assert_eq!(rpt, 0u128);
    }

    #[test]
    fn test_no_rewards_when_unstaked() {
        // Guard clause: when total_staked == 0 the accumulator is skipped.
        // Simulate the guard:
        let total_staked = 0u64;
        let rpt_before   = 42_000_000_000_000u128; // some existing value

        let rpt_after = if total_staked > 0 {
            rpt_before + compute_rpt_delta(1_000, total_staked, 100)
        } else {
            rpt_before // accumulator does NOT advance
        };

        assert_eq!(rpt_after, rpt_before, "rpt must not change while pool is empty");
    }

    #[test]
    fn test_min_stake_duration_guard() {
        let stake_time    = 1_000i64;
        let min_duration  = 86_400i64; // 1 day
        let now_too_early = 1_000 + 3_600i64; // 1 hour later
        let now_ok        = 1_000 + 86_400i64; // exactly 1 day later

        assert!(
            now_too_early - stake_time < min_duration,
            "early unstake should be rejected"
        );
        assert!(
            now_ok - stake_time >= min_duration,
            "after min duration unstake should succeed"
        );
    }

    #[test]
    fn test_rpt_precision_small_stake() {
        // Even with a tiny stake (1 token, 6 dec → 1 raw unit) the math
        // should not lose all precision within a realistic time window.
        let rate    = 1_000u64;     // 1000 raw tokens/sec
        let staked  = 1u64;         // 1 raw token staked
        let elapsed = 1u64;         // 1 second

        let rpt_delta = compute_rpt_delta(rate, staked, elapsed);
        // delta = 1000 * 1e12 / 1 = 1e15
        assert_eq!(rpt_delta, 1_000 * PRECISION);

        // Earned for that 1-token position: 1 * 1e15 / 1e12 = 1000 tokens
        let earned = user_earned(1u64, rpt_delta);
        assert_eq!(earned, 1_000u64);
    }
}
