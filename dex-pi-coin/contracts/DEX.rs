// SPDX-License-Identifier: MIT
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Map, String, Vec, symbol_short, log, panic_with_error
};
use soroban_sdk::token_contract;

// Error enum
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DEXError {
    InvalidAmount,
    InsufficientLiquidity,
    PoolNotFound,
    Paused,
    FeeTooHigh,
}

// Pool struct
#[contracttype]
#[derive(Clone)]
pub struct Pool {
    token_a: Address,      // Token A contract ID
    token_b: Address,      // Token B contract ID
    amount_a: u128,        // Token A reserves
    amount_b: u128,        // Token B reserves
    total_liquidity: u128, // Total liquidity provided
}

// Contract state
#[contracttype]
#[derive(Clone)]
pub struct DEXState {
    pools: Map<(Address, Address), Pool>, // (tokenA, tokenB) -> Pool
    user_liquidity: Map<(Address, Address, Address), u128>, // (tokenA, tokenB, user) -> liquidity
    fee_percentage: u32,   // Fee in percentage (e.g., 100 = 1%)
    paused: bool,          // Pause state
}

// Events
#[contracttype]
pub enum DEXEvent {
    LiquidityAdded(Address, Address, u128, u128),
    LiquidityRemoved(Address, Address, u128, u128),
    TokensSwapped(Address, Address, u128, u128),
    FeesWithdrawn(Address, u128),
    FeeUpdated(u32),
    Paused,
    Unpaused,
}

#[contract]
pub struct DEX;

#[contractimpl]
impl DEX {
    // Initialize contract
    pub fn initialize(env: Env, admin: Address, fee_percentage: u32) {
        admin.require_auth();
        if fee_percentage > 10000 {
            panic_with_error!(&env, DEXError::FeeTooHigh);
        }
        let state = DEXState {
            pools: Map::new(&env),
            user_liquidity: Map::new(&env),
            fee_percentage,
            paused: false,
        };
        env.storage().instance().set(&symbol_short!("STATE"), &state);
        env.storage().instance().set(&symbol_short!("ADMIN"), &admin);
        log!(&env, "DEX initialized with admin: {}, fee: {}%", admin, fee_percentage);
    }

    // Add liquidity to a pool
    pub fn add_liquidity(
        env: Env,
        user: Address,
        token_a: Address,
        token_b: Address,
        amount_a: u128,
        amount_b: u128,
    ) {
        user.require_auth();
        let state: DEXState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        if state.paused {
            panic_with_error!(&env, DEXError::Paused);
        }
        if amount_a == 0 || amount_b == 0 {
            panic_with_error!(&env, DEXError::InvalidAmount);
        }

        // Transfer tokens to contract
        let token_a_client = token_contract::Client::new(&env, &token_a);
        let token_b_client = token_contract::Client::new(&env, &token_b);
        token_a_client.transfer(&user, &env.current_contract_address(), &amount_a);
        token_b_client.transfer(&user, &env.current_contract_address(), &amount_b);

        // Update pool
        let mut state = state;
        let pool_key = (token_a.clone(), token_b.clone());
        let mut pool = state.pools.get(pool_key.clone()).unwrap_or(Pool {
            token_a,
            token_b,
            amount_a: 0,
            amount_b: 0,
            total_liquidity: 0,
        });

        pool.amount_a += amount_a;
        pool.amount_b += amount_b;
        pool.total_liquidity += amount_a + amount_b;

        // Update user liquidity
        let liquidity_key = (token_a.clone(), token_b.clone(), user.clone());
        let user_liquidity = state.user_liquidity.get(liquidity_key.clone()).unwrap_or(0);
        state.user_liquidity.set(liquidity_key, user_liquidity + amount_a + amount_b);

        // Save state
        state.pools.set(pool_key, pool);
        env.storage().instance().set(&symbol_short!("STATE"), &state);

        env.events().publish(
            (symbol_short!("LiquidityAdded"),),
            (token_a, token_b, amount_a, amount_b),
        );
        log!(&env, "Added liquidity: {} {} and {} {}", amount_a, token_a, amount_b, token_b);
    }

    // Remove liquidity from a pool
    pub fn remove_liquidity(
        env: Env,
        user: Address,
        token_a: Address,
        token_b: Address,
        amount_a: u128,
        amount_b: u128,
    ) {
        user.require_auth();
        let state: DEXState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        if state.paused {
            panic_with_error!(&env, DEXError::Paused);
        }
        if amount_a == 0 || amount_b == 0 {
            panic_with_error!(&env, DEXError::InvalidAmount);
        }

        let pool_key = (token_a.clone(), token_b.clone());
        let pool = state.pools.get(pool_key.clone()).unwrap_or_else(|| {
            panic_with_error!(&env, DEXError::PoolNotFound)
        });

        if pool.amount_a < amount_a || pool.amount_b < amount_b {
            panic_with_error!(&env, DEXError::InsufficientLiquidity);
        }

        // Update pool
        let mut state = state;
        let mut pool = pool;
        pool.amount_a -= amount_a;
        pool.amount_b -= amount_b;
        pool.total_liquidity -= amount_a + amount_b;

        // Update user liquidity
        let liquidity_key = (token_a.clone(), token_b.clone(), user.clone());
        let user_liquidity = state.user_liquidity.get(liquidity_key.clone()).unwrap_or(0);
        if user_liquidity < amount_a + amount_b {
            panic_with_error!(&env, DEXError::InsufficientLiquidity);
        }
        state.user_liquidity.set(liquidity_key, user_liquidity - (amount_a + amount_b));

        // Transfer tokens back to user
        let token_a_client = token_contract::Client::new(&env, &token_a);
        let token_b_client = token_contract::Client::new(&env, &token_b);
        token_a_client.transfer(&env.current_contract_address(), &user, &amount_a);
        token_b_client.transfer(&env.current_contract_address(), &user, &amount_b);

        // Save state
        state.pools.set(pool_key, pool);
        env.storage().instance().set(&symbol_short!("STATE"), &state);

        env.events().publish(
            (symbol_short!("LiquidityRemoved"),),
            (token_a, token_b, amount_a, amount_b),
        );
        log!(&env, "Removed liquidity: {} {} and {} {}", amount_a, token_a, amount_b, token_b);
    }

    // Swap tokens
    pub fn swap_tokens(
        env: Env,
        user: Address,
        token_in: Address,
        token_out: Address,
        amount_in: u128,
    ) -> u128 {
        user.require_auth();
        let state: DEXState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        if state.paused {
            panic_with_error!(&env, DEXError::Paused);
        }
        if amount_in == 0 {
            panic_with_error!(&env, DEXError::InvalidAmount);
        }

        let pool_key = (token_in.clone(), token_out.clone());
        let pool = state.pools.get(pool_key.clone()).unwrap_or_else(|| {
            panic_with_error!(&env, DEXError::PoolNotFound)
        });

        if pool.amount_a == 0 || pool.amount_b == 0 {
            panic_with_error!(&env, DEXError::InsufficientLiquidity);
        }

        // Calculate amount out with 0.3% fee (997/1000)
        let amount_out = Self::get_amount_out(&env, amount_in, pool.amount_a, pool.amount_b);
        if amount_out == 0 {
            panic_with_error!(&env, DEXError::InsufficientLiquidity);
        }

        // Apply 1% fee
        let fee = amount_in * state.fee_percentage as u128 / 100;
        let amount_in_after_fee = amount_in - fee;

        // Transfer tokens
        let token_in_client = token_contract::Client::new(&env, &token_in);
        let token_out_client = token_contract::Client::new(&env, &token_out);
        token_in_client.transfer(&user, &env.current_contract_address(), &amount_in);
        token_out_client.transfer(&env.current_contract_address(), &user, &amount_out);

        // Update pool
        let mut state = state;
        let mut pool = pool;
        pool.amount_a += amount_in_after_fee;
        pool.amount_b -= amount_out;
        state.pools.set(pool_key, pool);
        env.storage().instance().set(&symbol_short!("STATE"), &state);

        env.events().publish(
            (symbol_short!("TokensSwapped"),),
            (token_in, token_out, amount_in, amount_out),
        );
        log!(&env, "Swapped {} {} for {} {}", amount_in, token_in, amount_out, token_out);

        amount_out
    }

    // Calculate amount out
    pub fn get_amount_out(env: &Env, amount_in: u128, reserve_in: u128, reserve_out: u128) -> u128 {
        if amount_in == 0 || reserve_in == 0 || reserve_out == 0 {
            panic_with_error!(env, DEXError::InvalidAmount);
        }

        let amount_in_with_fee = amount_in * 997; // 0.3% fee
        let numerator = amount_in_with_fee * reserve_out;
        let denominator = reserve_in * 1000 + amount_in_with_fee;
        numerator / denominator
    }

    // Withdraw fees (only admin)
    pub fn withdraw_fees(env: Env, admin: Address, token: Address) {
        admin.require_auth();
        Self::only_admin(&env);
        let token_client = token_contract::Client::new(&env, &token);
        let amount = token_client.balance(&env.current_contract_address());
        if amount == 0 {
            panic_with_error!(&env, DEXError::InvalidAmount);
        }

        token_client.transfer(&env.current_contract_address(), &admin, &amount);
        env.events().publish((symbol_short!("FeesWithdrawn"),), (token, amount));
        log!(&env, "Withdrew {} fees for token {}", amount, token);
    }

    // Update fee percentage (only admin)
    pub fn update_fee_percentage(env: Env, admin: Address, new_fee: u32) {
        admin.require_auth();
        Self::only_admin(&env);
        if new_fee > 10000 {
            panic_with_error!(&env, DEXError::FeeTooHigh);
        }
        let mut state: DEXState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        state.fee_percentage = new_fee;
        env.storage().instance().set(&symbol_short!("STATE"), &state);
        env.events().publish((symbol_short!("FeeUpdated"),), new_fee);
        log!(&env, "Updated fee to {}%", new_fee);
    }

    // Pause contract (only admin)
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();
        Self::only_admin(&env);
        let mut state: DEXState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        state.paused = true;
        env.storage().instance().set(&symbol_short!("STATE"), &state);
        env.events().publish((symbol_short!("Paused"),), ());
    }

    // Unpause contract (only admin)
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        Self::only_admin(&env);
        let mut state: DEXState = env.storage().instance().get(&symbol_short!("STATE")).unwrap();
        state.paused = false;
        env.storage().instance().set(&symbol_short!("STATE"), &state);
        env.events().publish((symbol_short!("Unpaused"),), ());
    }

    // Helper: Check if caller is admin
    fn only_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&symbol_short!("ADMIN")).unwrap();
        if env.current_caller() != admin {
            panic!("Only admin can call this function");
        }
    }
}
