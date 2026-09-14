// Local control panel for the mandate demo. Keeps both the agent's and the
// admin's testnet secrets server-side (never sent to the browser) and
// exposes a small API the frontend calls to actually submit transfer
// decisions and mandate updates through the deployed smart account +
// mandate policy on Stellar testnet.
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { loadDeployed, loadSecrets } from "./config.js";
import { submitDecision, submitMandateUpdate, getLiveMandateData, getAccountBalance } from "./invoke.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function labelizeAllowlist(addresses, recipients) {
  const byAddr = Object.fromEntries(Object.entries(recipients).map(([label, addr]) => [addr, label]));
  return addresses.map((addr) => byAddr[addr] || addr);
}

app.get("/api/state", async (req, res) => {
  const d = loadDeployed();
  try {
    const { agentOpsSecret } = loadSecrets();
    const [live, balance] = await Promise.all([
      getLiveMandateData({
        mandatePolicyId: d.mandatePolicyId,
        agentContextRuleId: d.agentContextRuleId,
        smartAccountId: d.smartAccountId,
        readerSecret: agentOpsSecret,
      }),
      getAccountBalance({ tokenId: d.tokenId, smartAccountId: d.smartAccountId, readerSecret: agentOpsSecret }),
    ]);
    res.json({
      mandate: { max_amount_xlm: live.max_amount_xlm, allowlist: labelizeAllowlist(live.allowlist, d.recipients) },
      balanceXlm: balance,
      contracts: {
        mandatePolicyId: d.mandatePolicyId,
        smartAccountId: d.smartAccountId,
        ed25519VerifierId: d.ed25519VerifierId,
        tokenId: d.tokenId,
      },
      recipients: d.recipients,
    });
  } catch (err) {
    // Fall back to the deploy-time snapshot if the live read fails for any
    // reason (e.g. RPC hiccup) — better a possibly-stale mandate than none.
    res.json({
      mandate: d.mandate,
      contracts: {
        mandatePolicyId: d.mandatePolicyId,
        smartAccountId: d.smartAccountId,
        ed25519VerifierId: d.ed25519VerifierId,
        tokenId: d.tokenId,
      },
      recipients: d.recipients,
      warning: `Live mandate read failed, showing deploy-time snapshot: ${err.message}`,
    });
  }
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
      contextRuleId: d.agentContextRuleId,
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

app.post("/api/admin/update-mandate", async (req, res) => {
  const d = loadDeployed();
  const { newMaxAmountXlm, newAllowlist } = req.body;

  if (newMaxAmountXlm === undefined && newAllowlist === undefined) {
    return res.status(400).json({ error: "Provide newMaxAmountXlm and/or newAllowlist" });
  }
  let newMaxAmount;
  if (newMaxAmountXlm !== undefined) {
    const n = Number(newMaxAmountXlm);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: "newMaxAmountXlm must be a positive number" });
    }
    newMaxAmount = BigInt(Math.round(n * 1e7));
  }
  if (newAllowlist !== undefined) {
    if (!Array.isArray(newAllowlist) || newAllowlist.length === 0) {
      return res.status(400).json({ error: "newAllowlist must be a non-empty array of G... addresses" });
    }
    for (const addr of newAllowlist) {
      if (typeof addr !== "string" || !addr.startsWith("G") || addr.length !== 56) {
        return res.status(400).json({ error: `Invalid address in newAllowlist: ${addr}` });
      }
    }
  }

  try {
    const { agentOpsSecret, adminSigningSecret } = loadSecrets();
    if (!adminSigningSecret) {
      return res.status(500).json({ error: "ADMIN_SIGNING_SECRET is not configured on this server" });
    }
    const result = await submitMandateUpdate({
      smartAccountId: d.smartAccountId,
      mandatePolicyId: d.mandatePolicyId,
      agentContextRuleId: d.agentContextRuleId,
      adminContextRuleId: d.adminContextRuleId,
      sourceSecret: agentOpsSecret,
      verifierId: d.ed25519VerifierId,
      adminSigningSecret,
      newMaxAmount,
      newAllowlist,
      label: "admin update_mandate",
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4310;
app.listen(PORT, () => {
  console.log(`Mandate control panel running at http://localhost:${PORT}`);
});
