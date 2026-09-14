//! # Spending Mandate Policy Module
//!
//! Encodes a simple spending mandate a human approves once for an AI agent's
//! smart account: a maximum amount per transaction, and an allowlist of
//! recipients the agent may pay. Every `transfer` call the account attempts
//! is checked against both constraints before authorization succeeds; a
//! violation panics, which reverts the transaction on-chain.
use soroban_sdk::{
    auth::{Context, ContractContext},
    contracterror, contractevent, contracttype, panic_with_error, symbol_short, Address, Env,
    TryFromVal, Vec,
};

use stellar_accounts::smart_account::{ContextRule, ContextRuleType, Signer};

/// Event emitted when a decision is approved by the mandate.
#[contractevent]
#[derive(Clone)]
pub struct MandateApproved {
    #[topic]
    pub smart_account: Address,
    pub context_rule_id: u32,
    pub recipient: Address,
    pub amount: i128,
}

/// Event emitted when the mandate policy is installed.
#[contractevent]
#[derive(Clone, Debug)]
pub struct MandateInstalled {
    #[topic]
    pub smart_account: Address,
    pub context_rule_id: u32,
    pub max_amount: i128,
    pub allowlist: Vec<Address>,
}

/// Event emitted when the mandate policy is uninstalled.
#[contractevent]
#[derive(Clone, Debug)]
pub struct MandateUninstalled {
    #[topic]
    pub smart_account: Address,
    pub context_rule_id: u32,
}

/// Installation parameters for the mandate policy.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MandateAccountParams {
    /// The maximum amount allowed per individual transaction (in stroops).
    pub max_amount: i128,
    /// The list of recipient addresses this mandate permits paying.
    pub allowlist: Vec<Address>,
}

/// Internal storage structure for a mandate.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MandateData {
    pub max_amount: i128,
    pub allowlist: Vec<Address>,
}

/// Error codes for mandate policy operations.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum MandateError {
    /// The smart account does not have a mandate policy installed.
    NotInstalled = 3300,
    /// The mandate policy was already installed for this context rule.
    AlreadyInstalled = 3301,
    /// The mandate parameters (max_amount / allowlist) are invalid.
    InvalidParams = 3302,
    /// The transaction amount exceeds the mandate's per-transaction limit.
    AmountExceedsLimit = 3303,
    /// The recipient is not on the mandate's allowlist.
    RecipientNotAllowed = 3304,
    /// The call is not a recognized/allowed transfer operation.
    NotAllowed = 3305,
    /// Only the `CallContract` context rule type is allowed.
    OnlyCallContractAllowed = 3306,
}

/// Storage keys for mandate policy data.
#[contracttype]
pub enum MandateStorageKey {
    AccountContext(Address, u32),
}

// ################## QUERY STATE ##################

pub fn get_mandate_data(e: &Env, context_rule_id: u32, smart_account: &Address) -> MandateData {
    let key = MandateStorageKey::AccountContext(smart_account.clone(), context_rule_id);
    e.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with_error!(e, MandateError::NotInstalled))
}

// ################## CHANGE STATE ##################

/// Enforces the mandate: the call must be a `transfer(from, to, amount)`
/// where `to` is on the allowlist and `amount` does not exceed `max_amount`.
/// Requires authorization from the smart account.
pub fn enforce(
    e: &Env,
    context: &Context,
    authenticated_signers: &Vec<Signer>,
    context_rule: &ContextRule,
    smart_account: &Address,
) {
    smart_account.require_auth();

    // The mandate only means something if it's bound to the specific agent
    // key the human approved — without this, anyone could submit a
    // mandate-compliant call. Signer validation is deferred to policies
    // whenever a policy is attached (see smart-account/README "Authorization
    // Flow"), so this check is what actually enforces "only the AI agent's
    // key" rather than "anyone who stays under the limit."
    if authenticated_signers.is_empty() {
        panic_with_error!(e, MandateError::NotAllowed)
    }

    let data = get_mandate_data(e, context_rule.id, smart_account);

    match context {
        Context::Contract(ContractContext { fn_name, args, .. }) => {
            if fn_name == &symbol_short!("transfer") {
                if let (Some(to_val), Some(amount_val)) = (args.get(1), args.get(2)) {
                    if let (Ok(to), Ok(amount)) = (
                        Address::try_from_val(e, &to_val),
                        i128::try_from_val(e, &amount_val),
                    ) {
                        if amount <= 0 {
                            panic_with_error!(e, MandateError::NotAllowed)
                        }

                        if amount > data.max_amount {
                            panic_with_error!(e, MandateError::AmountExceedsLimit)
                        }

                        if !data.allowlist.contains(&to) {
                            panic_with_error!(e, MandateError::RecipientNotAllowed)
                        }

                        MandateApproved {
                            smart_account: smart_account.clone(),
                            context_rule_id: context_rule.id,
                            recipient: to,
                            amount,
                        }
                        .publish(e);

                        return;
                    }
                }
            }
        }
        _ => panic_with_error!(e, MandateError::NotAllowed),
    }
    panic_with_error!(e, MandateError::NotAllowed)
}

/// Installs the mandate policy on a smart account. Only `CallContract` is
/// allowed as the context type, pinning the mandate to a specific token
/// contract so `amount` is always denominated in the same asset.
pub fn install(
    e: &Env,
    params: &MandateAccountParams,
    context_rule: &ContextRule,
    smart_account: &Address,
) {
    smart_account.require_auth();

    if !matches!(context_rule.context_type, ContextRuleType::CallContract(_)) {
        panic_with_error!(e, MandateError::OnlyCallContractAllowed)
    }

    if params.max_amount <= 0 || params.allowlist.is_empty() {
        panic_with_error!(e, MandateError::InvalidParams)
    }

    let key = MandateStorageKey::AccountContext(smart_account.clone(), context_rule.id);

    if e.storage().persistent().has(&key) {
        panic_with_error!(e, MandateError::AlreadyInstalled)
    }

    let data = MandateData { max_amount: params.max_amount, allowlist: params.allowlist.clone() };
    e.storage().persistent().set(&key, &data);

    MandateInstalled {
        smart_account: smart_account.clone(),
        context_rule_id: context_rule.id,
        max_amount: params.max_amount,
        allowlist: params.allowlist.clone(),
    }
    .publish(e);
}

/// Uninstalls the mandate policy, removing all stored data.
pub fn uninstall(e: &Env, context_rule: &ContextRule, smart_account: &Address) {
    smart_account.require_auth();

    let key = MandateStorageKey::AccountContext(smart_account.clone(), context_rule.id);

    if !e.storage().persistent().has(&key) {
        panic_with_error!(e, MandateError::NotInstalled)
    }

    e.storage().persistent().remove(&key);

    MandateUninstalled { smart_account: smart_account.clone(), context_rule_id: context_rule.id }
        .publish(e);
}
