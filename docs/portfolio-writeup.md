# Mandate Ledger

**One-liner (for a portfolio card):**
A Soroban smart account that lets an AI agent spend autonomously within a
human-approved mandate — enforced on-chain, adjustable later without
redeploying, and provably rejecting anything out of bounds.

**Links:**
- Live demo: https://mandate.nataliaserranoortiz.com
- Source: https://github.com/nserrano07/mandate-ledger
- Slides (PDF): [`docs/mandate-ledger-slides.pdf`](mandate-ledger-slides.pdf)

**Stack:** Rust / Soroban (Stellar smart contracts) · OpenZeppelin `stellar-accounts` · Node.js · Vercel serverless functions · vanilla JS/HTML/CSS

---

## The problem

Autonomous agents that can move money are useful — paying vendors, settling
invoices, topping up services without a human in the loop. But "trust the
agent's own code" doesn't scale: a bug, a bad prompt, or a compromised key
turns into an unbounded blank check. Enforcement has to live somewhere the
agent literally cannot touch — not in its logic, not in a UI warning, in
the ledger itself.

## The approach

A human approves a spending mandate once — a maximum amount per transaction
and a recipient allowlist — installed as a custom Soroban `Policy` contract
on an OpenZeppelin `stellar-accounts` smart account. Every payment the agent
proposes is checked against that mandate by the deployed contract before it
can settle. Violations panic on-chain — visibly rejected, not silently
filtered client-side.

The mandate isn't frozen at deploy time. The account carries a **second,
admin-only context rule** — scoped to a different contract, secured by a
different Ed25519 identity — so a human can raise or lower the limit, or
edit the allowlist, live, via `update_mandate()`, without ever redeploying.
The agent's key structurally cannot reach that rule (wrong contract scope);
the admin's rule structurally cannot move funds (same reason, inverted).
Two identities, two blast radiuses, enforced by the framework itself rather
than application logic.

## Architecture

```
Human (one-time)
   │  installs mandate: max amount + allowlist
   ▼
Smart Account (OpenZeppelin stellar-accounts)
   │
   ├─ Context rule 0 — CallContract(token)
   │     • Agent's Ed25519 signer (External, verified on-chain)
   │     • mandate-policy attached → every transfer checked
   │
   └─ Context rule 1 — CallContract(mandate-policy)
         • Admin's Ed25519 signer (different identity)
         • No policy — signature alone authorizes update_mandate()

AI Agent ──sign──▶ transfer(to, amount) ──▶ mandate-policy.enforce()
                                                 │
                                    ✅ within mandate → settles on testnet
                                    ❌ violates mandate → panics, reverts

Human Admin ──sign──▶ update_mandate(new_limit, new_allowlist)
                                                 │
                                    settles → mandate changes immediately,
                                    agent's next call is checked against it
```

Three Rust contracts (`mandate-policy`, `smart-account`, `ed25519-verifier`),
a Node control panel (Vercel serverless functions: `/api/state`,
`/api/decide`, `/api/admin/update-mandate`), and a static dashboard —
secrets never touch the browser or the public repo.

## Technical highlights worth calling out

- **Custom Soroban authorization from scratch.** OpenZeppelin's smart-account
  framework leaves signature construction to the client — there's no SDK
  helper for it. Had to hand-build the exact `SorobanAuthorizationEntry` +
  the framework's own `AuthPayload` wire format (a named-struct `ScVal::Map`),
  compute the two-stage auth digest (`sha256(signature_payload ||
  context_rule_ids.to_xdr())`), and sign it with a real Ed25519 key — all in
  JS, verified against the actual deployed Rust contract on testnet.
- **A real access-control boundary, not just a check.** The admin/agent
  separation isn't an `if (isAdmin)` in application code — it's two
  differently-scoped context rules in the framework itself. Proved it live:
  raised the limit from 100→150 XLM via the admin identity, confirmed a
  payment that would have failed under the old limit now settles, confirmed
  one still over the new limit still fails — same contract, no redeploy.
- **A real security incident, caught and fixed mid-project.** An earlier
  static-page version embedded live secret keys client-side for a
  GitHub Pages demo. Rotated both keys immediately, redeployed under a
  server-held-secrets architecture (Vercel serverless functions + env vars),
  and rewrote the public repo's git history to remove the leaked commit —
  documented in the repo's commit history rather than swept under the rug.
- **Deployment across a broken toolchain.** Windows Smart App Control
  blocked the Rust build tooling entirely; solved by building inside a
  headless WSL2 Ubuntu environment instead of fighting the host OS policy.

## What I'd extend next

- Persist the activity log (currently per-session only) via Soroban event
  indexing instead of client-side state.
- A richer admin audit trail — who changed what, when, surfaced in the UI
  rather than just on-chain events.
- Multi-admin support (an M-of-N rule instead of a single admin signer),
  using OpenZeppelin's own threshold policies.
