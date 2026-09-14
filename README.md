# Mandate Ledger — retired

This repo previously hosted a fully static, client-side control panel for a
Stellar testnet smart-account mandate demo. It embedded testnet secret keys
directly in browser-executed JavaScript so the page could sign and submit
transactions with no backend.

That was a mistake: anyone could view-source and extract the keys. Even
though the keys only controlled testnet play money, the pattern itself is
unsafe and shouldn't be left live or referenced as an example.

**This repo is retired.** GitHub Pages has been disabled and the leaking
`index.html` removed. The keys it exposed have been rotated — the smart
account and agent identity now in use are different from what this repo
ever referenced.

The working demo now runs as a small local server that keeps secrets
server-side (never sent to the browser). See the parent hackathon project's
`scripts/server.js` + `scripts/public/index.html`.
