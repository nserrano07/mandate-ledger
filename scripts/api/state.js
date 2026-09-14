// Vercel serverless function: GET /api/state
// Returns only public contract IDs/addresses — no secrets ever touch this.
// The mandate itself is read LIVE from chain (it can change post-deploy via
// update_mandate), never trusted from deployed.json's deploy-time snapshot.
import { loadDeployed, loadSecrets } from "../config.js";
import { getLiveMandateData, getAccountBalance } from "../invoke.js";

function labelizeAllowlist(addresses, recipients) {
  const byAddr = Object.fromEntries(Object.entries(recipients).map(([label, addr]) => [addr, label]));
  return addresses.map((addr) => byAddr[addr] || addr);
}

export default async function handler(req, res) {
  const d = loadDeployed();
  const contracts = {
    mandatePolicyId: d.mandatePolicyId,
    smartAccountId: d.smartAccountId,
    ed25519VerifierId: d.ed25519VerifierId,
    tokenId: d.tokenId,
  };

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
    res.status(200).json({
      mandate: { max_amount_xlm: live.max_amount_xlm, allowlist: labelizeAllowlist(live.allowlist, d.recipients) },
      balanceXlm: balance,
      contracts,
      recipients: d.recipients,
    });
  } catch (err) {
    res.status(200).json({
      mandate: d.mandate,
      contracts,
      recipients: d.recipients,
      warning: `Live mandate read failed, showing deploy-time snapshot: ${err.message}`,
    });
  }
}
