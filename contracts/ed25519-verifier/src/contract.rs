//! # Ed25519 Verifier Contract
//!
//! A reusable, stateless verifier contract (OpenZeppelin's `Verifier` trait)
//! that lets the smart account authenticate the AI agent's own Ed25519 key
//! as an `External` signer, on top of the mandate policy's amount/allowlist
//! checks — cloned from OpenZeppelin's multisig-smart-account example.
use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env, Vec};
use stellar_accounts::verifiers::{ed25519, Verifier};

#[contract]
pub struct Ed25519VerifierContract;

#[contractimpl]
impl Verifier for Ed25519VerifierContract {
    type KeyData = BytesN<32>;
    type SigData = BytesN<64>;

    fn verify(e: &Env, signature_payload: Bytes, key_data: BytesN<32>, sig_data: BytesN<64>) -> bool {
        ed25519::verify(e, &signature_payload, &key_data, &sig_data)
    }

    fn canonicalize_key(e: &Env, key_data: BytesN<32>) -> Bytes {
        ed25519::canonicalize_key(e, &key_data)
    }

    fn batch_canonicalize_key(e: &Env, keys_data: Vec<BytesN<32>>) -> Vec<Bytes> {
        ed25519::batch_canonicalize_key(e, &keys_data)
    }
}
