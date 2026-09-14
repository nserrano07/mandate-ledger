import { rpc, TransactionBuilder, Operation, Keypair, Address, nativeToScVal, scValToNative, xdr, BASE_FEE } from "@stellar/stellar-sdk";
import { RPC_URL, NETWORK_PASSPHRASE, EXPLORER_TX } from "./config.js";
import { buildSignedTransferAuthEntry, buildSignedAuthEntry } from "./mandate-auth.js";

const server = new rpc.Server(RPC_URL);

/**
 * Reads the mandate's *current* on-chain state directly (max_amount +
 * allowlist), via a read-only simulated call to `get_mandate_data`. The
 * mandate can change post-deploy via `update_mandate`, so anything showing
 * "the current mandate" must read this live rather than trusting
 * deployed.json's deploy-time snapshot.
 */
export async function getLiveMandateData({ mandatePolicyId, agentContextRuleId, smartAccountId, readerSecret }) {
  const readerKeypair = Keypair.fromSecret(readerSecret);
  const readerAccount = await server.getAccount(readerKeypair.publicKey());

  const op = Operation.invokeContractFunction({
    contract: mandatePolicyId,
    function: "get_mandate_data",
    args: [xdr.ScVal.scvU32(agentContextRuleId), new Address(smartAccountId).toScVal()],
  });

  const tx = new TransactionBuilder(readerAccount, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`get_mandate_data simulation failed: ${sim.error}`);
  }
  const native = scValToNative(sim.result.retval);
  return {
    max_amount_xlm: Number(native.max_amount) / 1e7,
    allowlist: native.allowlist, // array of G... addresses
  };
}

/**
 * Decodes a Soroban contract panic code out of a simulation/tx error
 * string, e.g. "...Error(Contract, #3304)..." -> 3304, and maps it to a
 * human explanation using the mandate-policy error table.
 */
const MANDATE_ERRORS = {
  3300: "mandate not installed",
  3301: "mandate already installed",
  3302: "invalid mandate parameters",
  3303: "AMOUNT EXCEEDS MANDATE LIMIT",
  3304: "RECIPIENT NOT ON MANDATE ALLOWLIST",
  3305: "call not allowed by mandate",
  3306: "only CallContract context rule allowed",
};

function explainError(errorText) {
  const match = /Error\(Contract, #(\d+)\)/.exec(errorText || "");
  if (!match) return null;
  const code = parseInt(match[1], 10);
  return { code, reason: MANDATE_ERRORS[code] || "unknown contract error" };
}

/**
 * Signs, submits, and polls a prepared transaction to a final outcome.
 * Shared by the agent's transfers and the admin's mandate updates — only
 * how the operation + auth entry get built differs between the two.
 */
async function signSubmitAndPoll({ tx, sourceKeypair, resultFields }) {
  const sim = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(sim)) {
    const decoded = explainError(sim.error);
    return {
      ...resultFields,
      outcome: "REJECTED_AT_SIMULATION",
      detail: decoded ? `${decoded.reason} (contract error #${decoded.code})` : sim.error,
      raw: sim.error,
    };
  }

  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(sourceKeypair);

  const sendResult = await server.sendTransaction(prepared);

  if (sendResult.status === "ERROR") {
    const decoded = explainError(JSON.stringify(sendResult.errorResult));
    return {
      ...resultFields,
      outcome: "REJECTED_AT_SUBMIT",
      detail: decoded ? `${decoded.reason} (contract error #${decoded.code})` : JSON.stringify(sendResult.errorResult),
      hash: sendResult.hash,
    };
  }

  let getResult = await server.getTransaction(sendResult.hash);
  let attempts = 0;
  while (getResult.status === "NOT_FOUND" && attempts < 20) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
    attempts += 1;
  }

  if (getResult.status === "SUCCESS") {
    return { ...resultFields, outcome: "SETTLED", hash: sendResult.hash, explorer: EXPLORER_TX(sendResult.hash) };
  }

  // The transaction landed in a ledger but failed at apply time. Soroban's
  // getTransaction doesn't hand back a clean "Error(Contract, #N)" string
  // here (that only appears in simulation diagnostics) — the explorer link
  // has the full, human-readable failure detail.
  return {
    ...resultFields,
    outcome: "REJECTED_ON_CHAIN",
    detail: `transaction failed on-chain (status=${getResult.status}) — see explorer link for details`,
    hash: sendResult.hash,
    explorer: EXPLORER_TX(sendResult.hash),
  };
}

/**
 * Submits one "AI decision": a transfer(from=smartAccount, to, amount) call
 * on the token contract, authorized via our hand-built AuthPayload entry so
 * the smart account's mandate policy really runs. Returns a result object
 * describing what happened — settled on-chain, or rejected by the mandate.
 */
export async function submitDecision({
  smartAccountId,
  tokenId,
  contextRuleId,
  sourceSecret,
  verifierId,
  agentSigningSecret,
  toId,
  toLabel,
  amount,
  label,
}) {
  const sourceKeypair = Keypair.fromSecret(sourceSecret);
  const agentKeypair = Keypair.fromSecret(agentSigningSecret);
  const sourceAccount = await server.getAccount(sourceKeypair.publicKey());
  const latestLedger = await server.getLatestLedger();
  const signatureExpirationLedger = latestLedger.sequence + 100;

  const authEntry = buildSignedTransferAuthEntry({
    smartAccountId,
    tokenId,
    toId,
    amount,
    contextRuleId,
    signatureExpirationLedger,
    verifierId,
    agentKeypair,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const op = Operation.invokeContractFunction({
    contract: tokenId,
    function: "transfer",
    args: [
      new Address(smartAccountId).toScVal(),
      new Address(toId).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ],
    auth: [authEntry],
  });

  const tx = new TransactionBuilder(sourceAccount, {
    fee: (BigInt(BASE_FEE) * 50n).toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  return signSubmitAndPoll({ tx, sourceKeypair, resultFields: { label, toLabel, amount } });
}

/**
 * Submits an admin `update_mandate` call — signed by the admin's Ed25519
 * key (never the agent's), authorized under the account's admin-only
 * context rule (scoped to `CallContract(mandatePolicyId)`, no policy
 * attached, so the signature alone is the requirement). Pass `undefined`
 * for whichever of `newMaxAmount` / `newAllowlist` should be left as-is.
 */
export async function submitMandateUpdate({
  smartAccountId,
  mandatePolicyId,
  agentContextRuleId, // which mandate's data to change (rule 0's, the agent's)
  adminContextRuleId, // which rule authorizes THIS call (rule 1, the admin's)
  sourceSecret,
  verifierId,
  adminSigningSecret,
  newMaxAmount, // bigint stroops, or undefined to leave unchanged
  newAllowlist, // array of G... addresses, or undefined to leave unchanged
  label,
}) {
  const sourceKeypair = Keypair.fromSecret(sourceSecret);
  const adminKeypair = Keypair.fromSecret(adminSigningSecret);
  const sourceAccount = await server.getAccount(sourceKeypair.publicKey());
  const latestLedger = await server.getLatestLedger();
  const signatureExpirationLedger = latestLedger.sequence + 100;

  const maxAmountScVal =
    newMaxAmount === undefined ? xdr.ScVal.scvVoid() : nativeToScVal(newMaxAmount, { type: "i128" });
  const allowlistScVal =
    newAllowlist === undefined
      ? xdr.ScVal.scvVoid()
      : xdr.ScVal.scvVec(newAllowlist.map((addr) => new Address(addr).toScVal()));

  const args = [
    xdr.ScVal.scvU32(agentContextRuleId),
    new Address(smartAccountId).toScVal(),
    maxAmountScVal,
    allowlistScVal,
  ];

  const authEntry = buildSignedAuthEntry({
    smartAccountId,
    targetContractId: mandatePolicyId,
    functionName: "update_mandate",
    args,
    contextRuleId: adminContextRuleId,
    signatureExpirationLedger,
    verifierId,
    signerKeypair: adminKeypair,
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  const op = Operation.invokeContractFunction({
    contract: mandatePolicyId,
    function: "update_mandate",
    args,
    auth: [authEntry],
  });

  const tx = new TransactionBuilder(sourceAccount, {
    fee: (BigInt(BASE_FEE) * 50n).toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();

  return signSubmitAndPoll({
    tx,
    sourceKeypair,
    resultFields: {
      label,
      newMaxAmount: newMaxAmount !== undefined ? newMaxAmount.toString() : undefined,
      newAllowlist,
    },
  });
}

export { explainError };
