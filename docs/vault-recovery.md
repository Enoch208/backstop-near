# Vault recovery candidate

These changes apply to a new build of the contract. The recorded testnet deployment remains pinned to its earlier build until upgraded. The CI chain job tests the candidate on local NEAR and separately reproduces the checksum of the deployed version from its pinned commit. `pnpm verify:testnet` verifies the deployment, not the candidate.

- Every guarantee is backed by an attached deposit reserved to one task. A second task must receive a separate deposit before it can use that collateral.
- The task customer, guarantor, coordinator, verifier and vault account cannot be worker payees. The lead must be one of the paid workers. Distinct on-chain accounts can still be controlled by the same party.
- Once the deadline has passed, anyone can call `finalize_failure` for an eligible unfinished task. The caller cannot redirect funds. An accepted task remains on the success path, and the contract refuses a verdict first submitted after the deadline.
- Once the automatic retry cap is exhausted, the recorded recipient can call `claim_failed_transfer` with its `transfer_id`. The amount, pool and recipient remain fixed. Only a confirmed failed transfer can be retried; a pending or confirmed one cannot be sent again. If the account no longer exists, this path is usable after it is restored to the same address.

Use `get_task`, `get_ledger`, and `get_transfer` to check the current state from a public NEAR RPC. `cargo test --locked` under `contracts/outcome-vault` covers refused payouts, separate task bonds, overdue claims and replayed callbacks. `pnpm vault:build` builds a candidate and prints its hash. The Linux CI artifact and its checksum are the reviewed release inputs; the pinned deployed checksum and source should move together with a separately verified testnet upgrade.

The coordinator still selects the winner off chain and the verifier remains an authorized signer. A coordinated group using separate accounts can still collude, and payout recovery does not infer the outcome of a lost callback. The current vault pays for its own storage.
