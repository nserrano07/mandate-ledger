import { rpc, TransactionBuilder, Operation, Keypair, Address, nativeToScVal, BASE_FEE } from "@stellar/stellar-sdk";
import { RPC_URL, NETWORK_PASSPHRASE, EXPLORER_TX } from "./config.js";
import { buildSignedTransferAuthEntry } from "./mandate-auth.js";

const server = new rpc.Server(RPC_URL);

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

  const sim = await server.simulateTransaction(tx);

  if (rpc.Api.isSimulationError(sim)) {
    const decoded = explainError(sim.error);
    return {
      label,
      toLabel,
      amount,
      outcome: "REJECTED_AT_SIMULATION",
      detail: decoded ? `${decoded.reason} (contract error #${decoded.code})` : sim.error,
      raw: sim.error,
    };
  }

  const preparedBuilder = rpc.assembleTransaction(tx, sim);
  const prepared = preparedBuilder.build();
  prepared.sign(sourceKeypair);

  const sendResult = await server.sendTransaction(prepared);

  if (sendResult.status === "ERROR") {
    const decoded = explainError(JSON.stringify(sendResult.errorResult));
    return {
      label,
      toLabel,
      amount,
      outcome: "REJECTED_AT_SUBMIT",
      detail: decoded ? `${decoded.reason} (contract error #${decoded.code})` : JSON.stringify(sendResult.errorResult),
      hash: sendResult.hash,
    };
  }

  // Poll for final status.
  let getResult = await server.getTransaction(sendResult.hash);
  let attempts = 0;
  while (getResult.status === "NOT_FOUND" && attempts < 20) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
    attempts += 1;
  }

  if (getResult.status === "SUCCESS") {
    return {
      label,
      toLabel,
      amount,
      outcome: "SETTLED",
      hash: sendResult.hash,
      explorer: EXPLORER_TX(sendResult.hash),
    };
  }

  // The transaction landed in a ledger but failed at apply time. Soroban's
  // getTransaction doesn't hand back a clean "Error(Contract, #N)" string
  // here (that only appears in simulation diagnostics) — the explorer link
  // has the full, human-readable failure detail.
  return {
    label,
    toLabel,
    amount,
    outcome: "REJECTED_ON_CHAIN",
    detail: `transaction failed on-chain (status=${getResult.status}) — see explorer link for details`,
    hash: sendResult.hash,
    explorer: EXPLORER_TX(sendResult.hash),
  };
}

export { explainError };
