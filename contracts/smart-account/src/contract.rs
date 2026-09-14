//! # AI Agent Smart Account
//!
//! A minimal Soroban smart account built on OpenZeppelin's smart-account
//! framework (`stellar-accounts`). A human approves a spending mandate once
//! by deploying this account with two context rules:
//!
//! - `CallContract(token)`, carrying the AI agent's own signer + the
//!   mandate policy — every payment the agent attempts through that token
//!   contract is checked against the mandate before authorization succeeds.
//! - `CallContract(mandate_policy)`, carrying only the human admin's own
//!   signer and no policy — this is the lever the admin uses to update the
//!   mandate's limit or allowlist later, without redeploying. The agent's
//!   key cannot reach this rule (it's scoped to a different contract), and
//!   this rule cannot move funds (it's scoped away from the token contract).
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    map, vec, Address, Env, Map, String, Symbol, Val, Vec,
};
use stellar_accounts::smart_account::{
    self, AuthPayload, ContextRule, ContextRuleType, ExecutionEntryPoint, Signer, SmartAccount,
    SmartAccountError,
};

#[contract]
pub struct AgentAccount;

#[contractimpl]
impl AgentAccount {
    /// Sets up the account with the agent's transfer-scoped mandate rule
    /// and the admin's mandate-management rule (see module docs above).
    pub fn __constructor(
        e: &Env,
        token: Address,
        signers: Vec<Signer>,
        policies: Map<Address, Val>,
        mandate_policy: Address,
        admin_signer: Signer,
    ) {
        smart_account::add_context_rule(
            e,
            &ContextRuleType::CallContract(token),
            &String::from_str(e, "agent-mandate"),
            None,
            &signers,
            &policies,
        );

        smart_account::add_context_rule(
            e,
            &ContextRuleType::CallContract(mandate_policy),
            &String::from_str(e, "admin-control"),
            None,
            &vec![e, admin_signer],
            &map![e],
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
