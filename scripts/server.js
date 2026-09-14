// Local control panel for the mandate demo. Keeps the agent's testnet
// secrets server-side (never sent to the browser) and exposes a small API
// the frontend calls to actually submit transfer decisions through the
// deployed smart account + mandate policy on Stellar testnet.
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { loadDeployed, loadSecrets } from "./config.js";
import { submitDecision } from "./invoke.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const XLM = 10_000_000n;

app.get("/api/state", (req, res) => {
  const d = loadDeployed();
  res.json({
    mandate: d.mandate,
    contracts: {
      mandatePolicyId: d.mandatePolicyId,
      smartAccountId: d.smartAccountId,
      ed25519VerifierId: d.ed25519VerifierId,
      tokenId: d.tokenId,
    },
    recipients: d.recipients,
  });
});

app.post("/api/decide", async (req, res) => {
  const d = loadDeployed();
  const { toId, toLabel, amountXlm } = req.body;

  if (!toId || typeof toId !== "string" || !toId.startsWith("G") || toId.length !== 56) {
    return res.status(400).json({ error: "toId must be a valid Stellar G... address" });
  }
  const amountNum = Number(amountXlm);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: "amountXlm must be a positive number" });
  }

  try {
    const { agentOpsSecret, agentSigningSecret } = loadSecrets();
    const result = await submitDecision({
      smartAccountId: d.smartAccountId,
      tokenId: d.tokenId,
      contextRuleId: d.contextRuleId,
      sourceSecret: agentOpsSecret,
      verifierId: d.ed25519VerifierId,
      agentSigningSecret,
      toId,
      toLabel: toLabel || toId,
      amount: BigInt(Math.round(amountNum * 1e7)),
      label: `pay ${toLabel || toId} — ${amountNum} XLM`,
    });
    res.json({
      ...result,
      amount: amountNum,
      amountStroops: (BigInt(Math.round(amountNum * 1e7))).toString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4310;
app.listen(PORT, () => {
  console.log(`Mandate control panel running at http://localhost:${PORT}`);
});
