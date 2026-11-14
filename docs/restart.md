# Restart the coordinator

`pnpm api` binds to loopback by default and stores state in `.backstop/state.sqlite`. Set `BACKSTOP_STATE_PATH` to an absolute path for a dedicated run. Restart with the same file, port and vault configuration. The SQLite database has one active writer; a second coordinator opening it is refused. With `BACKSTOP_DEMO=1`, restart also relaunches built-in workers for tasks still running. Old leases remain fenced until expiry or reassignment.

The API commits an accepted signed request's reply and corresponding state together, then publishes events. Repeating the same operation with a fresh signature and the same request ID returns the recorded reply. Reusing that ID with a different operation is refused.

For an existing testnet vault, set `BACKSTOP_API_VAULT=testnet`, `BACKSTOP_TESTNET_ACCOUNT` to the vault root, and `BACKSTOP_CUSTOMER_PUBLIC_KEY`, `BACKSTOP_GUARANTOR_PUBLIC_KEY`, and `BACKSTOP_COORDINATOR_PUBLIC_KEY` to distinct 64-character hexadecimal ed25519 request signing keys. Keep the matching private seeds with their respective clients. The coordinator uses the existing customer, guarantor, coordinator, and verifier account credentials under `~/.near-credentials/testnet` for the vault connection. Use a dedicated state file for each vault. The fixture credentials are public and for local demonstrations.

Before sending a transaction, the bridge journals its signed bytes. After restart it looks up that same hash and checks actual transfer state from NEAR before confirming payment. If the original transaction outcome is unavailable and its signed bytes have expired, it requires operator reconciliation. Keep the database on durable storage and preserve it during restarts.

Run `pnpm test --project api persistence.test.ts` to exercise checkpoint and request replay. Run `pnpm vault:build` and `pnpm test:chain --project api-chain restart.chain.test.ts` to exercise NEAR funding and payout recovery with dropped final RPC replies. The chain test uses a local node.
