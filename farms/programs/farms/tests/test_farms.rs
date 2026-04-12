/// Integration + smoke tests for the BASEDFARMS single-sided staking program.
///
/// Test structure
/// ──────────────
/// 1. `test_program_loads`             – .so loads cleanly into LiteSVM.
/// 2. `test_instruction_discriminators`– all 5 instruction discriminators are
///                                       unique and of the correct length.
/// 3. `test_pda_derivation`            – farm / vault / position PDAs are stable.
/// 4. `test_initialize_farm`           – full initialize_farm round-trip with mocked
///                                       SPL Token mint accounts.
///
/// All reward-math correctness tests live in `lib.rs` under `#[cfg(test)] mod tests`.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::instruction::Instruction,
        AnchorDeserialize,
        InstructionData,
        ToAccountMetas,
    },
    farms::{FarmState, ID as PROGRAM_ID},
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program_option::COption,
    solana_program_pack::Pack,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    spl_token_interface::{
        state::{Account as SplTokenAccount, AccountState, Mint},
        ID as SPL_TOKEN_ID,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn program_bytes() -> &'static [u8] {
    include_bytes!("../../../target/deploy/farms.so")
}

fn send_tx(
    svm: &mut LiteSVM,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> litesvm::types::TransactionResult {
    let payer = signers[0];
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx)
}

fn find_pda(seeds: &[&[u8]]) -> (Pubkey, u8) {
    Pubkey::find_program_address(seeds, &PROGRAM_ID)
}

/// Create a minimal initialized SPL mint account in the SVM.
fn create_mint(svm: &mut LiteSVM, mint_pubkey: Pubkey, authority: Pubkey) {
    let mint = Mint {
        mint_authority: COption::Some(authority),
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut data = vec![0u8; Mint::LEN];
    mint.pack_into_slice(&mut data);

    let lamports = svm.minimum_balance_for_rent_exemption(Mint::LEN);
    svm.set_account(
        mint_pubkey,
        Account {
            lamports,
            data,
            owner: SPL_TOKEN_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

/// Create an initialized, empty SPL token account in the SVM.
fn create_token_account(svm: &mut LiteSVM, account_pubkey: Pubkey, mint: Pubkey, owner: Pubkey) {
    let ta = SplTokenAccount {
        mint,
        owner,
        amount: 0,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = vec![0u8; SplTokenAccount::LEN];
    ta.pack_into_slice(&mut data);

    let lamports = svm.minimum_balance_for_rent_exemption(SplTokenAccount::LEN);
    svm.set_account(
        account_pubkey,
        Account {
            lamports,
            data,
            owner: SPL_TOKEN_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Test 1 – program loads
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_program_loads() {
    let mut svm = LiteSVM::new();
    svm.add_program(PROGRAM_ID, program_bytes()).unwrap();
    // Reaching here without panic means the .so loaded correctly.
}

// ─────────────────────────────────────────────────────────────────────────────
//  Test 2 – instruction discriminators
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_instruction_discriminators() {
    let d_init    = farms::instruction::InitializeFarm { reward_rate_per_second: 0, min_stake_duration: 0 }.data();
    let d_stake   = farms::instruction::Stake { amount: 0 }.data();
    let d_unstake = farms::instruction::Unstake { amount: 0 }.data();
    let d_claim   = farms::instruction::ClaimRewards {}.data();
    let d_fund    = farms::instruction::FundRewards { amount: 0 }.data();

    // Discriminator is always the first 8 bytes.
    for (name, data) in [
        ("InitializeFarm", &d_init),
        ("Stake",          &d_stake),
        ("Unstake",        &d_unstake),
        ("ClaimRewards",   &d_claim),
        ("FundRewards",    &d_fund),
    ] {
        assert!(data.len() >= 8, "{name} discriminator must be at least 8 bytes");
    }

    // All discriminators must be distinct.
    let discs: Vec<[u8; 8]> = [&d_init, &d_stake, &d_unstake, &d_claim, &d_fund]
        .iter()
        .map(|d| {
            let mut arr = [0u8; 8];
            arr.copy_from_slice(&d[..8]);
            arr
        })
        .collect();
    let unique: std::collections::HashSet<[u8; 8]> = discs.iter().cloned().collect();
    assert_eq!(unique.len(), 5, "all 5 discriminators must be unique");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Test 3 – PDA derivation is deterministic
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_pda_derivation() {
    let authority = Pubkey::new_unique();
    let mint      = Pubkey::new_unique();

    let (farm1, bump1) = find_pda(&[b"farm",         mint.as_ref(), authority.as_ref()]);
    let (farm2, bump2) = find_pda(&[b"farm",         mint.as_ref(), authority.as_ref()]);
    assert_eq!(farm1, farm2,  "farm_state PDA must be deterministic");
    assert_eq!(bump1, bump2,  "farm_state bump must be deterministic");

    let (vault1, _) = find_pda(&[b"vault",        farm1.as_ref()]);
    let (vault2, _) = find_pda(&[b"vault",        farm2.as_ref()]);
    assert_eq!(vault1, vault2, "stake_vault PDA must be deterministic");

    let (rv1, _) = find_pda(&[b"reward_vault", farm1.as_ref()]);
    let (rv2, _) = find_pda(&[b"reward_vault", farm2.as_ref()]);
    assert_eq!(rv1, rv2, "reward_vault PDA must be deterministic");

    // Different mints must produce different farm PDAs.
    let other_mint = Pubkey::new_unique();
    let (farm_other, _) = find_pda(&[b"farm", other_mint.as_ref(), authority.as_ref()]);
    assert_ne!(farm1, farm_other, "different mints must yield different farm PDAs");

    // User stake-position PDA.
    let user = Pubkey::new_unique();
    let (pos1, _) = find_pda(&[b"stake", farm1.as_ref(), user.as_ref()]);
    let (pos2, _) = find_pda(&[b"stake", farm1.as_ref(), user.as_ref()]);
    assert_eq!(pos1, pos2, "stake_position PDA must be deterministic");

    // Different users must have different positions on the same farm.
    let other_user = Pubkey::new_unique();
    let (pos_other, _) = find_pda(&[b"stake", farm1.as_ref(), other_user.as_ref()]);
    assert_ne!(pos1, pos_other, "different users must yield different position PDAs");
}

// ─────────────────────────────────────────────────────────────────────────────
//  Test 4 – initialize_farm end-to-end
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_farm() {
    let mut svm = LiteSVM::new();
    svm.add_program(PROGRAM_ID, program_bytes()).unwrap();

    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();

    // Create a fake token mint (single-sided: stake = reward).
    let mint_kp = Keypair::new();
    create_mint(&mut svm, mint_kp.pubkey(), authority.pubkey());

    // Derive all PDAs.
    let (farm_state,   _) = find_pda(&[b"farm",         mint_kp.pubkey().as_ref(), authority.pubkey().as_ref()]);
    let (stake_vault,  _) = find_pda(&[b"vault",        farm_state.as_ref()]);
    let (reward_vault, _) = find_pda(&[b"reward_vault", farm_state.as_ref()]);

    // Parameters.
    let reward_rate:   u64 = 1_000;   // 1000 raw tokens/s
    let min_stake_dur: i64 = 60;      // 60-second lock

    // Build the instruction.
    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: farms::accounts::InitializeFarm {
            farm_state,
            stake_vault,
            reward_vault,
            stake_mint:     mint_kp.pubkey(),
            reward_mint:    mint_kp.pubkey(),
            authority:      authority.pubkey(),
            token_program:  SPL_TOKEN_ID,
            system_program: anchor_lang::solana_program::system_program::ID,
        }
        .to_account_metas(None),
        data: farms::instruction::InitializeFarm {
            reward_rate_per_second: reward_rate,
            min_stake_duration:     min_stake_dur,
        }
        .data(),
    };

    let res = send_tx(&mut svm, &[ix], &[&authority]);
    assert!(res.is_ok(), "initialize_farm failed: {:?}", res.err());

    // ── Verify on-chain state ─────────────────────────────────────────────
    let raw = svm.get_account(&farm_state).expect("farm_state must exist after init");
    let farm: FarmState =
        AnchorDeserialize::deserialize(&mut &raw.data[8..]).expect("deserialize FarmState");

    assert_eq!(farm.authority,              authority.pubkey(),  "authority mismatch");
    assert_eq!(farm.stake_mint,             mint_kp.pubkey(),    "stake_mint mismatch");
    assert_eq!(farm.reward_mint,            mint_kp.pubkey(),    "reward_mint mismatch");
    assert_eq!(farm.reward_rate,            reward_rate,          "reward_rate mismatch");
    assert_eq!(farm.min_stake_duration,     min_stake_dur,        "min_stake_duration mismatch");
    assert_eq!(farm.total_staked,           0,                    "total_staked must start at 0");
    assert_eq!(farm.reward_per_token_stored, 0,                   "rpt_stored must start at 0");

    // Vaults must have been created by the instruction.
    assert!(svm.get_account(&stake_vault).is_some(),  "stake_vault must exist");
    assert!(svm.get_account(&reward_vault).is_some(), "reward_vault must exist");

    println!("✓  farm_state   : {farm_state}");
    println!("✓  stake_vault  : {stake_vault}");
    println!("✓  reward_vault : {reward_vault}");
    println!("✓  reward_rate  : {reward_rate} tokens/s");
    println!("✓  min_lock     : {min_stake_dur}s");
}
