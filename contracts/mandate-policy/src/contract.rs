//! # Mandate Policy Contract
//!
//! A reusable Soroban policy contract implementing the OpenZeppelin
//! `Policy` trait. Encodes a spending mandate (max amount per transaction +
//! recipient allowlist) that a human approves once by installing it on a
//! smart account's context rule; every subsequent `transfer` call attempted
//! through that account is checked against it before authorization succeeds.
use soroban_sdk::{auth::Context, contract, contractimpl, Address, Env, Vec};
use stellar_accounts::{
    policies::Policy,
    smart_account::{ContextRule, Signer},
};

use crate::mandate;

#[contract]
pub struct MandatePolicyContract;

#[contractimpl]
impl Policy for MandatePolicyContract {
    type AccountParams = mandate::MandateAccountParams;

    fn enforce(
        e: &Env,
        context: Context,
        authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        mandate::enforce(e, &context, &authenticated_signers, &context_rule, &smart_account)
    }

    fn install(
        e: &Env,
        install_params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        mandate::install(e, &install_params, &context_rule, &smart_account)
    }

    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        mandate::uninstall(e, &context_rule, &smart_account)
    }
}

#[contractimpl]
impl MandatePolicyContract {
    /// Get the current mandate for a smart account's context rule.
    pub fn get_mandate_data(
        e: Env,
        context_rule_id: u32,
        smart_account: Address,
    ) -> mandate::MandateData {
        mandate::get_mandate_data(&e, context_rule_id, &smart_account)
    }

    /// Update an installed mandate's limit and/or allowlist. Requires
    /// authorization from the smart account under an admin-scoped context
    /// rule — see `mandate::update_mandate` for the authorization story.
    pub fn update_mandate(
        e: Env,
        context_rule_id: u32,
        smart_account: Address,
        new_max_amount: Option<i128>,
        new_allowlist: Option<Vec<Address>>,
    ) {
        mandate::update_mandate(&e, context_rule_id, &smart_account, new_max_amount, new_allowlist)
    }
}
