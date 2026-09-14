// Vercel serverless function: POST /api/decide
// Secrets come from process.env (set in the Vercel project's environment
// variables dashboard) via loadSecrets() — never from a file in this
// deployment, and never sent to the client.
import { loadDeployed, loadSecrets } from "../config.js";
import { submitDecision } from "../invoke.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const d = loadDeployed();
  const { toId, toLabel, amountXlm } = req.body || {};

  if (!toId || typeof toId !== "string" || !toId.startsWith("G") || toId.length !== 56) {
    res.status(400).json({ error: "toId must be a valid Stellar G... address" });
    return;
  }
  const amountNum = Number(amountXlm);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    res.status(400).json({ error: "amountXlm must be a positive number" });
    return;
  }

  try {
    const { agentOpsSecret, agentSigningSecret } = loadSecrets();
    const result = await submitDecision({
      smartAccountId: d.smartAccountId,
      tokenId: d.tokenId,
      contextRuleId: d.agentContextRuleId,
      sourceSecret: agentOpsSecret,
      verifierId: d.ed25519VerifierId,
      agentSigningSecret,
      toId,
      toLabel: toLabel || toId,
      amount: BigInt(Math.round(amountNum * 1e7)),
      label: `pay ${toLabel || toId} — ${amountNum} XLM`,
    });
    res.status(200).json({ ...result, amount: amountNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
