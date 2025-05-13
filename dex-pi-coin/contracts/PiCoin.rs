// SPDX-License-Identifier: MIT
use soroban_sdk::{contract, contractimpl, Address, Env, String, symbol_short, Vec, log};
use soroban_sdk::{contracttype, token_contract};

// Constants
const TOTAL_SUPPLY: u128 = 100_000_000_000_000_000_000_000; // 100 billion tokens (18 decimals)
const TARGET_PRICE: u128 = 314_159_000_000_000_000_000_000; // $314,159 in 18 decimals
const DECIMALS: u32 = 18;

// Storage for contract state
#[contracttype]
#[derive(Clone)]
pub struct PiCoinState {
    total_fees: u128, // Total fees collected
    transaction_fee: u32, // Fee in basis points (e.g., 100 = 1%)
    price_feed: Address, // Oracle address (placeholder)
    paused: bool, // Pause state
}

// Events
#[contracttype]
pub enum PiCoinEvent {
    PriceFeedUpdated(Address),
    TransactionFeeUpdated(u32),
    FeesCollected(u128),
    SupplyAdjusted(u128),
    Paused,
    Unpaused,
}

#[contract]
pub struct PiCoin;

// Contract implementation
#[contractimpl]
impl PiCoin {
    // Initialize contract
    pub fn initialize(env: Env, admin: Address, price_feed: Address) {
        admin.require_auth();
        let state = PiCoinState {
            total_fees: 0,
            transaction_fee: 100, // 1% fee
            price_feed,
            paused: false,
        };
        env.storage().instance().set(&symbol_short!("STATE"), &state);

        // Mint initial supply
        let token = token_contract::Client::new(&env, &env.current_contract_address());
        token.mint(&admin, &TOTAL_SUPPLY);
        log!(&env, "Initialized PiCoin with supply: {}", TOTAL_SUPPLY);
    }

    // Get metadata
    pub fn name(env: Env) -> String {
        String::from_str(&env, "PiCoin")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "Pi")
    }

    pub fn decimals(env: Env) -> u32 {
        DECIMALS
    }

    // Set price feed (only admin)
    pub fn set_price_feed(env: Env, admin: Address, new_price_feed: Address) {
        admin.require_auth();
        Self::only_admin(&env);
        let mut state: PiCoinState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        state.price_feed = new_price_feed;
        env.storage().instance().set(&symbol_short!("STATE"), &state);
        env.events().publish((symbol_short!("PriceFeedUpdated"),), new_price_feed);
    }

    // Get current price (placeholder for oracle)
    pub fn get_current_price(_env: Env) -> u128 {
        // TODO: Integrate with Stellar oracle (e.g., off-chain price feed via backend)
        TARGET_PRICE
    }

    // Adjust supply to stabilize price
    pub fn adjust_supply(env: Env, admin: Address) {
        admin.require_auth();
        Self::only_admin(&env);
        let current_price = Self::get_current_price(&env);
        let token = token_contract::Client::new(&env, &env.current_contract_address());

        if current_price < TARGET_PRICE {
            // Mint tokens to increase supply
            let amount_to_mint = (TARGET_PRICE - current_price) / 1_000_000_000_000_000_000 * 1000; // Simplified
            token.mint(&admin, &amount_to_mint);
            env.events().publish((symbol_short!("SupplyAdjusted"),), amount_to_mint);
            log!(&env, "Minted {} tokens to stabilize price", amount_to_mint);
        } else if current_price > TARGET_PRICE {
            // Burn tokens to decrease supply
            let amount_to_burn = (current_price - TARGET_PRICE) / 1_000_000_000_000_000_000 * 1000; // Simplified
            token.burn(&admin, &amount_to_burn);
            env.events().publish((symbol_short!("SupplyAdjusted"),), amount_to_burn);
            log!(&env, "Burned {} tokens to stabilize price", amount_to_burn);
        }
    }

    // Mint tokens (only admin)
    pub fn mint(env: Env, admin: Address, to: Address, amount: u128) {
        admin.require_auth();
        Self::only_admin(&env);
        let token = token_contract::Client::new(&env, &env.current_contract_address());
        token.mint(&to, &amount);
        log!(&env, "Minted {} tokens to {}", amount, to);
    }

    // Burn tokens (only admin)
    pub fn burn(env: Env, admin: Address, amount: u128) {
        admin.require_auth();
        Self::only_admin(&env);
        let token = token_contract::Client::new(&env, &env.current_contract_address());
        token.burn(&admin, &amount);
        log!(&env, "Burned {} tokens from {}", amount, admin);
    }

    // Pause contract (only admin)
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        Self::only_admin(&env);
        let mut state: PiCoinState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        state.paused = true;
        env.storage().instance().set(&symbol_short!("STATE"), &state);
        env.events().publish((symbol_short!("Paused"),), ());
    }

    // Unpause contract (only admin)
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        Self::only_admin(&env);
        let mut state: PiCoinState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        state.paused = false;
        env.storage().instance().set(&symbol_short!("STATE"), &state);
        env.events().publish((symbol_short!("Unpaused"),), ());
    }

    // Transfer with fees
    pub fn transfer(env: Env, from: Address, to: Address, amount: u128) {
        from.require_auth();
        let state: PiCoinState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        if state.paused {
            panic!("Contract is paused");
        }

        let fee = amount * state.transaction_fee as u128 / 10_000;
        let amount_after_fee = amount - fee;

        let token = token_contract::Client::new(&env, &env.current_contract_address());
        token.transfer(&from, &to, &amount_after_fee);
        token.transfer(&from, &env.current_contract_address(), &fee);

        let mut state = state;
        state.total_fees = state.total_fees + fee;
        env.storage().instance().set(&symbol_short!("STATE"), &state);
        env.events().publish((symbol_short!("FeesCollected"),), fee);
    }

    // Withdraw fees (only admin)
    pub fn withdraw_fees(env: Env, admin: Address) {
        admin.require_auth();
        Self::only_admin(&env);
        let mut state: PiCoinState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        let amount = state.total_fees;
        state.total_fees = 0;
        env.storage().instance().set(&symbol_short!("STATE"), &state);

        let token = token_contract::Client::new(&env, &env.current_contract_address());
        token.transfer(&env.current_contract_address(), &admin, &amount);
        log!(&env, "Withdrew {} fees to {}", amount, admin);
    }

    // Update transaction fee (only admin)
    pub fn update_transaction_fee(env: Env, admin: Address, new_fee: u32) {
        admin.require_auth();
        Self::only_admin(&env);
        if new_fee > 1000 {
            panic!("Fee cannot exceed 10%");
        }
        let mut state: PiCoinState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        state.transaction_fee = new_fee;
        env.storage().instance().set(&symbol_short!("STATE"), &state);
        env.events().publish((symbol_short!("TransactionFeeUpdated"),), new_fee);
    }

    // Helper: Check if caller is admin
    fn only_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&symbol_short!("ADMIN")).unwrap();
        if env.current_caller() != admin {
            panic!("Only admin can call this function");
        }
    }
}
