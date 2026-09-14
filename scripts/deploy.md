# Deploy checklist (testnet)

Run from `contracts/` after `stellar contract build` succeeds, wasm at
`target/wasm32v1-none/release/*.wasm`. This deploys three contracts and one
smart account with **two** context rules — see `contracts/smart-account/src/contract.rs`
for why: an agent-scoped rule that can only ever move funds within the
mandate, and an admin-scoped rule (a separate identity) that can only ever
adjust the mandate — neither can do the other's job.

## 1. Deploy the reusable contracts

```bash
# The mandate itself: max amount + allowlist, checked on every transfer,
# with update_mandate() gated to whoever authorizes under the admin rule.
stellar contract deploy --source admin --network testnet \
  --alias mandate-policy \
  --wasm target/wasm32v1-none/release/mandate_policy.wasm

# Verifies Ed25519 signatures for both the agent's and the admin's External
# signers. Stateless and reusable — deploy once, share across accounts.
stellar contract deploy --source admin --network testnet \
  --alias ed25519-verifier \
  --wasm target/wasm32v1-none/release/ed25519_verifier.wasm
```

## 2. Generate the two signing identities

Neither of these needs to be a funded classic account — they're raw
Ed25519 keypairs registered as `Signer::External(verifier, pubkey)`:

```bash
node -e "
const sdk = require('@stellar/stellar-sdk');
const kp = sdk.Keypair.random();
console.log(JSON.stringify({ secret: kp.secret(), pubkeyHex: Buffer.from(kp.rawPublicKey()).toString('hex') }, null, 2));
"
```

Run it twice — once for the agent, once for the admin. Save both secrets
into `scripts/.env` as `AGENT_SIGNING_SECRET` / `ADMIN_SIGNING_SECRET`.

A separate, *funded* classic account pays transaction fees and submits —
this is `AGENT_OPS_SECRET`:

```bash
stellar keys generate agent-ops --network testnet --fund
stellar keys show agent-ops   # -> AGENT_OPS_SECRET
```

## 3. Deploy the smart account

```bash
stellar contract deploy --source admin --network testnet \
  --alias agent-account \
  --wasm target/wasm32v1-none/release/smart_account.wasm \
  -- \
  --token <NATIVE_XLM_SAC_ID> \
  --signers '[{"External": ["<VERIFIER_ID>", "<AGENT_PUBKEY_HEX>"]}]' \
  --policies '{"<MANDATE_POLICY_ID>": {"map": [
      {"key": {"symbol": "allowlist"}, "val": {"vec": [
          {"address": "<PAYEE_1_ADDR>"},
          {"address": "<PAYEE_2_ADDR>"}
      ]}},
      {"key": {"symbol": "max_amount"}, "val": {"i128": "1000000000"}}
  ]}}' \
  --mandate_policy <MANDATE_POLICY_ID> \
  --admin_signer '{"External": ["<VERIFIER_ID>", "<ADMIN_PUBKEY_HEX>"]}'
```

Get the native XLM SAC id with:
`stellar contract id asset --asset native --network testnet`

This creates two context rules in one shot: rule `0` (`agent-mandate`,
scoped to `CallContract(token)`, carrying the agent's signer + the mandate
policy) and rule `1` (`admin-control`, scoped to `CallContract(mandate_policy)`,
carrying only the admin's signer, no policy — so the signature alone
authorizes calling `update_mandate`).

## 4. Fund the smart account

```bash
stellar contract invoke --source admin --network testnet --id <SAC_ID> \
  -- transfer --from admin --to <AGENT_ACCOUNT_ID> --amount 5000000000
```

## 5. Record everything

Public IDs/addresses go in `scripts/deployed.json` (`mandatePolicyId`,
`ed25519VerifierId`, `smartAccountId`, `tokenId`, `agentContextRuleId: 0`,
`adminContextRuleId: 1`, `recipients`, `mandate`). Secrets go in
`scripts/.env` only — see `scripts/.env.example`.

## 6. Verify

```bash
stellar contract invoke --source admin --network testnet --id <ACCOUNT_ID> -- get_context_rule --context_rule_id 0
stellar contract invoke --source admin --network testnet --id <ACCOUNT_ID> -- get_context_rule --context_rule_id 1
stellar contract invoke --source admin --network testnet --id <MANDATE_POLICY_ID> -- get_mandate_data --context_rule_id 0 --smart_account <ACCOUNT_ID>
```

Then run `node run-demo.js` (agent decisions) and, from the admin panel or
`POST /api/admin/update-mandate`, try raising the limit and re-running a
decision that would have failed under the old one.
