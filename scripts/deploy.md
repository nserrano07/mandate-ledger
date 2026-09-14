# Deploy checklist (testnet)

Run from `contracts/` after `stellar contract build` succeeds, wasm at
`target/wasm32v1-none/release/*.wasm`.

1. Deploy the mandate policy contract (reusable, stateless-by-account storage):

```
stellar contract deploy --source admin --network testnet \
  --alias mandate-policy \
  --wasm target/wasm32v1-none/release/mandate_policy.wasm
```

2. Deploy the smart account, pointing it at the native XLM SAC as the
   governed token, zero signers (mandate policy is the sole authorization
   requirement), and the mandate policy installed with its params:

```
stellar contract deploy --source admin --network testnet \
  --alias agent-account \
  --wasm target/wasm32v1-none/release/smart_account.wasm \
  -- \
  --token <SAC_ID> \
  --signers '[]' \
  --policies '{"<MANDATE_POLICY_ID>": {"map": [
      {"key": {"symbol": "allowlist"}, "val": {"vec": [
          {"address": "<CAFE_SUPPLIER_ADDR>"},
          {"address": "<CLOUD_PROVIDER_ADDR>"}
      ]}},
      {"key": {"symbol": "max_amount"}, "val": {"i128": "1000000000"}}
  ]}}'
```

3. Fund the smart account's SAC balance from admin:

```
stellar contract invoke --source admin --network testnet --id <SAC_ID> \
  -- transfer --from admin --to <AGENT_ACCOUNT_ID> --amount 5000000000
```

4. Record addresses into `scripts/deployed.json`.
