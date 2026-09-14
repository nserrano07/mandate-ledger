import dotenv from "dotenv";
import { Networks } from "@stellar/stellar-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });

export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const EXPLORER_TX = (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

const DEPLOY_FILE = path.join(__dirname, "deployed.json");

export function loadDeployed() {
  if (!fs.existsSync(DEPLOY_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf8"));
}

export function saveDeployed(data) {
  const merged = { ...loadDeployed(), ...data };
  fs.writeFileSync(DEPLOY_FILE, JSON.stringify(merged, null, 2));
}

// Secrets live only in scripts/.env (gitignored) or the hosting platform's
// environment variable dashboard — never in deployed.json.
export function loadSecrets() {
  const { AGENT_OPS_SECRET, AGENT_SIGNING_SECRET } = process.env;
  if (!AGENT_OPS_SECRET || !AGENT_SIGNING_SECRET) {
    throw new Error(
      "Missing AGENT_OPS_SECRET / AGENT_SIGNING_SECRET. Copy scripts/.env.example to scripts/.env and fill in your testnet keys."
    );
  }
  return { agentOpsSecret: AGENT_OPS_SECRET, agentSigningSecret: AGENT_SIGNING_SECRET };
}
