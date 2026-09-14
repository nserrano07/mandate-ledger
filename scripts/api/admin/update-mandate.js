// Vercel serverless function: POST /api/admin/update-mandate
// Signed by the admin's key (never the agent's), authorized under the
// account's admin-only context rule. Secrets come from process.env (set in
// the Vercel project's environment variables dashboard) — never from a
// file in this deployment, and never sent to the client.
import { loadDeployed, loadSecrets } from "../../config.js";
import { submitMandateUpdate } from "../../invoke.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const d = loadDeployed();
  const { newMaxAmountXlm, newAllowlist } = req.body || {};

  if (newMaxAmountXlm === undefined && newAllowlist === undefined) {
    res.status(400).json({ error: "Provide newMaxAmountXlm and/or newAllowlist" });
    return;
  }
  let newMaxAmount;
  if (newMaxAmountXlm !== undefined) {
    const n = Number(newMaxAmountXlm);
    if (!Number.isFinite(n) || n <= 0) {
      res.status(400).json({ error: "newMaxAmountXlm must be a positive number" });
      return;
    }
    newMaxAmount = BigInt(Math.round(n * 1e7));
  }
  if (newAllowlist !== undefined) {
    if (!Array.isArray(newAllowlist) || newAllowlist.length === 0) {
      res.status(400).json({ error: "newAllowlist must be a non-empty array of G... addresses" });
      return;
    }
    for (const addr of newAllowlist) {
      if (typeof addr !== "string" || !addr.startsWith("G") || addr.length !== 56) {
        res.status(400).json({ error: `Invalid address in newAllowlist: ${addr}` });
        return;
      }
    }
  }

  try {
    const { agentOpsSecret, adminSigningSecret } = loadSecrets();
    if (!adminSigningSecret) {
      res.status(500).json({ error: "ADMIN_SIGNING_SECRET is not configured on this server" });
      return;
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
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
