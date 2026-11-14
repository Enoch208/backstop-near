# Token-denominated rescue vault

The candidate vault supports one settlement asset per deployment. The existing deployment uses native NEAR. A fresh vault initialized with `new_with_token` pins one NEP-141 token contract and the minimum escrow in that token's base units. Escrow, premium, bond, payee shares, and ledger balances all use those units throughout the task. Token funding goes through `ft_transfer_call`; the vault credits the sender reported by the configured token contract. The existing task and settlement state machine handles verdicts, refunds, and transfer retries.

## Reproduce on a local NEAR node

```sh
curl -fsS 'https://raw.githubusercontent.com/near/core-contracts/1b0436c96379c63aee7d2429c6d5d24019031ab8/w-near/res/w_near.wasm' -o /tmp/backstop-wrap-fixture.wasm
pnpm vault:build
pnpm exec tsx scripts/prove-token-sandbox.ts /tmp/backstop-wrap-fixture.wasm
```

The proof checks the fixture checksum, starts NEAR Sandbox, and uses the reference wNEAR contract. A spoofed token callback and a native deposit are refused. An attempted top-up by the wrong payer is refunded by the token's resolver. A replacement worker's payout spends part of the guarantor bond. Its two token transfers fail while the worker has no token storage registration, then succeed when retried after registration. A separate exhausted task returns the escrow and pays capped compensation from the bond. The proof checks the vault and participant balances and verifies both duplicate settlements are refused. The deployed testnet vault still uses native NEAR.

## Mainnet rescue

Use a fresh vault pinned to Circle's native USDC contract `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. It uses six decimals. The token contract reported a 0.00125 NEAR minimum storage registration per account; re-read that value before deployment. Register the vault, customer, guarantor, and payout recipients with the token contract. The coordinator and verifier use separate accounts. Pin and verify the deployed WASM and register the verified enclave key if the run will use attested acceptance. [Official USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) · [NEP-141](https://github.com/near/NEPs/blob/master/neps/nep-0141.md)

The demo integrates the token vault with the live repair workers. It funds 1.00 USDC escrow, 0.10 USDC premium, and 0.40 USDC bond. The winning 1.20 USDC payout draws 1.00 USDC from escrow and 0.20 USDC from the bond. After confirming settlement, it checks the recipient and payout, total inflow and outflow, bond consumption, and the duplicate-settlement refusal.

```sh
pnpm demo --task fixtures/repair/normalize-intervals.json --chain sandbox \
  --token-fixture /tmp/backstop-wrap-fixture.wasm --task-id token-rescue-local \
  --output /tmp/token-rescue-local.js
```

For Circle USDC, provision a dedicated root with `vault`, `customer`, `guarantor`, `coordinator`, `verifier`, `alpha`, `beta`, and `gamma` subaccounts. Save the vault, customer, guarantor, coordinator, and verifier signing keys locally in `~/.near-credentials/<network>/`. Fund the vault with NEAR for storage and the signers with NEAR for gas. Register the vault, customer, guarantor, and both recovery payees on the token contract, and fund the customer with 1.10 USDC and guarantor with 0.40 USDC. The command checks registration and balances before deploying. Replace the example root and use testnet first, with [Circle's NEAR testnet USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses) and a fresh task ID.

```sh
pnpm demo --task fixtures/repair/normalize-intervals.json --chain testnet \
  --usdc-root YOUR_ROOT.testnet --task-id token-rescue-testnet \
  --output /tmp/token-rescue-testnet.js
```

Mainnet uses the same command with `--chain mainnet`, a dedicated `.near` root, and a different task ID and output path. Record the printed transaction links and keep the coordinator database at `.backstop/usdc-<task-id>.sqlite` for reconciliation. The live worker flow has been run in Sandbox with the reference wNEAR contract and scaled integer amounts. Public testnet and mainnet USDC runs require funded accounts.

For token funding, send a JSON string as `msg` through `ft_transfer_call`. Use `operation: "create"` with `task_id`, `manifest_hash`, and `policy`; `"escrow"` or `"premium"` with `task_id`; or `"guarantee"` with `task_id` and `max_liability`. Read the token callback or authoritative vault state to confirm funding, since NEP-141 can return the transferred tokens after a rejected callback.
