//! # AI Agent Smart Account
//!
//! A minimal Soroban smart account built on OpenZeppelin's smart-account
//! framework (`stellar-accounts`). A human approves a spending mandate once
//! by deploying this account with a mandate policy installed on a
//! `CallContract(token)` context rule; every payment the AI agent
//! subsequently attempts through that token contract is checked against the
//! mandate before authorization succeeds.
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    Address, Env, Map, String, Symbol, Val, Vec,
};
use stellar_accounts::smart_account::{
    self, AuthPayload, ContextRule, ContextRuleType, ExecutionEntryPoint, Signer, SmartAccount,
    SmartAccountError,
};

#[contract]
pub struct AgentAccount;

#[contractimpl]
impl AgentAccount {
    /// Sets up the account with a single context rule scoped to `token`
    /// (the asset the agent is allowed to move), carrying whatever signers
    /// and policies the human approving the mandate configures.
    pub fn __constructor(e: &Env, token: Address, signers: Vec<Signer>, policies: Map<Address, Val>) {
        smart_account::add_context_rule(
            e,
            &ContextRuleType::CallContract(token),
            &String::from_str(e, "agent-mandate"),
            None,
            &signers,
            &policies,
        );
    }
}

#[contractimpl]
impl CustomAccountInterface for AgentAccount {
    type Error = SmartAccountError;
    type Signature = AuthPayload;

    fn __check_auth(
        e: Env,
        signature_payload: Hash<32>,
        signatures: AuthPayload,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        smart_account::do_check_auth(&e, &signature_payload, &signatures, &auth_contexts)
    }
}

#[contractimpl(contracttrait)]
impl SmartAccount for AgentAccount {}

#[contractimpl(contracttrait)]
impl ExecutionEntryPoint for AgentAccount {}
