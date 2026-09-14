// Vercel serverless function: GET /api/state
// Returns only public contract IDs/addresses — no secrets ever touch this.
import { loadDeployed } from "../config.js";

export default function handler(req, res) {
  const d = loadDeployed();
  res.status(200).json({
    mandate: d.mandate,
    contracts: {
      mandatePolicyId: d.mandatePolicyId,
      smartAccountId: d.smartAccountId,
      ed25519VerifierId: d.ed25519VerifierId,
      tokenId: d.tokenId,
    },
    recipients: d.recipients,
  });
}
