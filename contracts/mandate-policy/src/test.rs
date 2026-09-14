extern crate std;

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, symbol_short,
    testutils::Address as _,
    Address, Env, IntoVal, Vec,
};

use crate::mandate::*;
use stellar_accounts::smart_account::{ContextRule, ContextRuleType, Signer};

#[contract]
struct MockContract;

fn create_context_rule(e: &Env, token: &Address) -> ContextRule {
    ContextRule {
        id: 1,
        context_type: ContextRuleType::CallContract(token.clone()),
        name: soroban_sdk::String::from_str(e, "mandate"),
        signers: Vec::<Signer>::new(e),
        signer_ids: Vec::new(e),
        policies: Vec::new(e),
        policy_ids: Vec::new(e),
        valid_until: None,
    }
}

fn one_signer(e: &Env) -> Vec<Signer> {
    Vec::from_array(e, [Signer::Delegated(Address::generate(e))])
}

fn transfer_context(e: &Env, token: &Address, from: &Address, to: &Address, amount: i128) -> Context {
    let mut args = Vec::new(e);
    args.push_back(from.into_val(e));
    args.push_back(to.into_val(e));
    args.push_back(amount.into_val(e));

    Context::Contract(ContractContext {
        contract: token.clone(),
        fn_name: symbol_short!("transfer"),
        args,
    })
}

#[test]
fn install_success() {
    let e = Env::default();
    let address = e.register(MockContract, ());
    let smart_account = Address::generate(&e);
    let token = Address::generate(&e);
    let allowed = Address::generate(&e);

    e.mock_all_auths();

    e.as_contract(&address, || {
        let context_rule = create_context_rule(&e, &token);
        let params = MandateAccountParams {
            max_amount: 1_000_000,
            allowlist: Vec::from_array(&e, [allowed.clone()]),
        };

        install(&e, &params, &context_rule, &smart_account);

        let data = get_mandate_data(&e, context_rule.id, &smart_account);
        assert_eq!(data.max_amount, 1_000_000);
        assert!(data.allowlist.contains(&allowed));
    });
}

#[test]
fn enforce_allows_valid_decision() {
    let e = Env::default();
    let address = e.register(MockContract, ());
    let smart_account = Address::generate(&e);
    let token = Address::generate(&e);
    let allowed = Address::generate(&e);
    let context_rule = create_context_rule(&e, &token);

    e.mock_all_auths();

    e.as_contract(&address, || {
        let params = MandateAccountParams {
            max_amount: 1_000_000,
            allowlist: Vec::from_array(&e, [allowed.clone()]),
        };
        install(&e, &params, &context_rule, &smart_account);
    });

    e.as_contract(&address, || {
        let context = transfer_context(&e, &token, &smart_account, &allowed, 500_000);
        // 500,000 <= max_amount and `allowed` is on the allowlist: must succeed.
        enforce(&e, &context, &one_signer(&e), &context_rule, &smart_account);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #3303)")]
fn enforce_rejects_amount_over_limit() {
    let e = Env::default();
    let address = e.register(MockContract, ());
    let smart_account = Address::generate(&e);
    let token = Address::generate(&e);
    let allowed = Address::generate(&e);
    let context_rule = create_context_rule(&e, &token);

    e.mock_all_auths();

    e.as_contract(&address, || {
        let params = MandateAccountParams {
            max_amount: 1_000_000,
            allowlist: Vec::from_array(&e, [allowed.clone()]),
        };
        install(&e, &params, &context_rule, &smart_account);
    });

    e.as_contract(&address, || {
        // 2,000,000 > max_amount of 1,000,000: must be rejected on-chain.
        let context = transfer_context(&e, &token, &smart_account, &allowed, 2_000_000);
        enforce(&e, &context, &one_signer(&e), &context_rule, &smart_account);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #3304)")]
fn enforce_rejects_recipient_not_on_allowlist() {
    let e = Env::default();
    let address = e.register(MockContract, ());
    let smart_account = Address::generate(&e);
    let token = Address::generate(&e);
    let allowed = Address::generate(&e);
    let stranger = Address::generate(&e);
    let context_rule = create_context_rule(&e, &token);

    e.mock_all_auths();

    e.as_contract(&address, || {
        let params = MandateAccountParams {
            max_amount: 1_000_000,
            allowlist: Vec::from_array(&e, [allowed.clone()]),
        };
        install(&e, &params, &context_rule, &smart_account);
    });

    e.as_contract(&address, || {
        // `stranger` is not on the allowlist: must be rejected on-chain.
        let context = transfer_context(&e, &token, &smart_account, &stranger, 100);
        enforce(&e, &context, &one_signer(&e), &context_rule, &smart_account);
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #3305)")]
fn enforce_rejects_when_no_authenticated_signer() {
    let e = Env::default();
    let address = e.register(MockContract, ());
    let smart_account = Address::generate(&e);
    let token = Address::generate(&e);
    let allowed = Address::generate(&e);
    let context_rule = create_context_rule(&e, &token);

    e.mock_all_auths();

    e.as_contract(&address, || {
        let params = MandateAccountParams {
            max_amount: 1_000_000,
            allowlist: Vec::from_array(&e, [allowed.clone()]),
        };
        install(&e, &params, &context_rule, &smart_account);
    });

    e.as_contract(&address, || {
        // No authenticated signer: even a compliant amount/recipient must be
        // rejected, because the mandate is bound to the agent's key.
        let context = transfer_context(&e, &token, &smart_account, &allowed, 100);
        enforce(&e, &context, &Vec::new(&e), &context_rule, &smart_account);
    });
}
