# Vault recovery on testnet

The recovery contract is deployed on `vault.backstop-6501bb.testnet`. The upgrade migrated the earlier vault state in [one testnet transaction](https://testnet.nearblocks.io/txns/EN4F6u3amTrzCkntDWbXoRKce2Y29c976z5ok3JNkGrf). CI checks the candidate build and reproduces the deployed checksum from its pinned source.

- Every guarantee is backed by an attached deposit reserved to one task. A second task must receive a separate deposit before it can use that collateral.
- The task customer, guarantor, coordinator, verifier and vault account cannot be worker payees. The lead must be one of the paid workers. Distinct on-chain accounts can still be controlled by the same party.
- Once the deadline has passed, anyone can call `finalize_failure` for an eligible unfinished task. The caller cannot redirect funds. An accepted task remains on the success path, and the contract refuses a verdict first submitted after the deadline.
- Once the automatic retry cap is exhausted, the recorded recipient can call `claim_failed_transfer` with its `transfer_id`. The amount, pool and recipient remain fixed. Only a confirmed failed transfer can be retried; a pending or confirmed one cannot be sent again. If the account no longer exists, this path is usable after it is restored to the same address.

Use `get_task`, `get_ledger`, and `get_transfer` to check the current state from a public NEAR RPC. `cargo test --locked` under `contracts/outcome-vault` covers refused payouts, separate task bonds, overdue claims and replayed callbacks. `pnpm vault:build` builds a candidate and prints its hash. The Linux CI artifact and its checksum are the reviewed release inputs; the pinned deployed checksum and source should move together with a separately verified testnet upgrade.

For testnet task `recovery-red-team-mwgrr0y8`, NEAR rejected an acceptance from the superseded first attempt. The verifier account could not refund the task before its deadline. After the deadline, that same account triggered a full 0.05 NEAR refund to the customer without a coordinator signature. A repeat refund was rejected. [Stale attempt](https://testnet.nearblocks.io/txns/GkhLGS5Tajf4kfya56V5BfUUdRLREQAhVx5VUnCMtjvJ) · [Early refund refusal](https://testnet.nearblocks.io/txns/4SAprVEDCxtYzrnWLxp2M2zNF6yLtkC91pWjU9kfq7JV) · [Confirmed refund](https://testnet.nearblocks.io/txns/9DzvoMC2D6eiSbMrxn1z1QXxtznwvM2vr4SA2QvLnzUA) · [Repeat refusal](https://testnet.nearblocks.io/txns/5J3SBMirpDuNMCNnzyUR7Vz5V67q3zL26DYq4eFkTPpw)

Verify with `pnpm verify:testnet --run recovery-red-team-mwgrr0y8`. To create a new proof task with your own deployed testnet vault and account keys, run `BACKSTOP_TESTNET_ACCOUNT=YOUR_ROOT.testnet pnpm chain:recovery-proof`.

The coordinator still selects the winner off chain and the verifier remains an authorized signer. A coordinated group using separate accounts can still collude, and payout recovery does not infer the outcome of a lost callback. The current vault pays for its own storage.
