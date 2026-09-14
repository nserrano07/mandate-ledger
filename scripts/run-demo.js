// Runs the hardcoded list of "AI agent" spending decisions through the
// deployed smart account + mandate policy on Stellar testnet.
//
// The mandate (set once by the human at deploy time): max 100 XLM per
// transaction, recipients limited to { cafe_supplier, cloud_provider }.
//
// Decisions 1-3 are legitimate agent payments within the mandate.
// Decision 4 pays a recipient NOT on the allowlist.
// Decision 5 exceeds the per-transaction amount limit.
// Both violations must be rejected — visibly, not silently skipped.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadDeployed, loadSecrets } from "./config.js";
import { submitDecision } from "./invoke.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const XLM = 10_000_000n; // stroops per XLM

async function main() {
  const deployed = loadDeployed();
  const required = ["smartAccountId", "tokenId", "contextRuleId", "ed25519VerifierId", "recipients"];
  for (const key of required) {
    if (!(key in deployed)) {
      throw new Error(`Missing "${key}" in scripts/deployed.json — run deploy step first.`);
    }
  }

  const { smartAccountId, tokenId, contextRuleId, ed25519VerifierId, recipients } = deployed;
  const { agentOpsSecret, agentSigningSecret } = loadSecrets();

  const decisions = [
    {
      label: "Decision 1: pay cafe_supplier for team lunch",
      toId: recipients.cafe_supplier,
      toLabel: "cafe_supplier (allowlisted)",
      amount: 25n * XLM,
    },
    {
      label: "Decision 2: pay cloud_provider hosting invoice",
      toId: recipients.cloud_provider,
      toLabel: "cloud_provider (allowlisted)",
      amount: 40n * XLM,
    },
    {
      label: "Decision 3: pay cafe_supplier for catering order",
      toId: recipients.cafe_supplier,
      toLabel: "cafe_supplier (allowlisted)",
      amount: 60n * XLM,
    },
    {
      label: "Decision 4: pay sketchy_wallet (NOT on allowlist)",
      toId: recipients.sketchy_wallet,
      toLabel: "sketchy_wallet (NOT allowlisted)",
      amount: 10n * XLM,
    },
    {
      label: "Decision 5: oversized transfer to cloud_provider (500 XLM > 100 XLM limit)",
      toId: recipients.cloud_provider,
      toLabel: "cloud_provider (allowlisted, but amount too high)",
      amount: 500n * XLM,
    },
  ];

  const results = [];
  for (const decision of decisions) {
    process.stdout.write(`\n=== ${decision.label} ===\n`);
    process.stdout.write(`  -> ${decision.toLabel}, amount = ${Number(decision.amount) / 1e7} XLM\n`);
    try {
      const result = await submitDecision({
        smartAccountId,
        tokenId,
        contextRuleId,
        sourceSecret: agentOpsSecret,
        verifierId: ed25519VerifierId,
        agentSigningSecret,
        toId: decision.toId,
        toLabel: decision.toLabel,
        amount: decision.amount,
        label: decision.label,
      });
      results.push(result);
      if (result.outcome === "SETTLED") {
        console.log(`  ✅ SETTLED on testnet. tx=${result.hash}`);
        console.log(`     ${result.explorer}`);
      } else {
        console.log(`  ❌ REJECTED (${result.outcome}): ${result.detail}`);
        if (result.explorer) console.log(`     ${result.explorer}`);
      }
    } catch (err) {
      console.log(`  ⚠️  Script error: ${err.message}`);
      results.push({ label: decision.label, outcome: "SCRIPT_ERROR", detail: err.message });
    }
  }

  console.log("\n\n================ SUMMARY ================");
  for (const r of results) {
    const tag = r.outcome === "SETTLED" ? "SETTLED " : "REJECTED";
    console.log(`[${tag}] ${r.label}`);
  }
  console.log("==========================================\n");

  const serializable = results.map((r) => ({
    ...r,
    amount: r.amount !== undefined ? (Number(r.amount) / 1e7).toString() : undefined,
  }));
  fs.writeFileSync(
    path.join(__dirname, "results.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), mandate: deployed.mandate, results: serializable }, null, 2)
  );
  console.log("Wrote scripts/results.json\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
