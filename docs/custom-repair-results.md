# Custom repair evidence — 15 November 2026

These are **post-deadline development checks**, using team-controlled accounts and workers, live NEAR AI Cloud inference, and native NEAR testnet transfers. They are not outside customer usage, independent operator evidence, a routing benchmark, or mainnet payments.

All funded tasks used 0.40 NEAR escrow, 0.04 premium, a 0.25 guarantor bond, a 0.10 compensation cap, up to three attempts and a five-minute task deadline. The service accepted the task bundles through its authenticated job API. Browser checks covered access refusal and invalid-task prevention; the real artifact download was checked through the frontend API proxy. The funded submissions were made through the API, not manually through the browser form.

## Checkpoint recovery

Task `repair-bbd3835f-6d50-4d44-8cc6-2658a9789daf` used the [staged warehouse task](../deployments/custom-repair-2026-11-15/staged-task.json). The primary's specified first stage only filtered inactive stock. It generated that partial checkpoint with live AI, then was deliberately killed. Three recovery offers were recorded: beta at 0.25 NEAR, the gamma/delta coalition at 0.60, and epsilon at 0.65. Beta won, verified the checkpoint hash, and produced a replacement passing **6/6 pinned checks**. The challenger found no counterexample among the one pinned probe.

The vault checked the accepted inference receipt and paid **0.25 NEAR to beta**, returned **0.19 to the customer**, and returned **0.25 to the guarantor**. Confirmed outflow equals the 0.69 NEAR inflow; no bond was consumed. Duplicate settlement was refused.

[Success transaction](https://testnet.nearblocks.io/txns/9xxki5YWjkX55Cup6JgnuunD8kn4zkVZtG7MXV5SRswp) · [Final report](../deployments/custom-repair-2026-11-15/recovery-report.json) · [Exact delivered source](../deployments/custom-repair-2026-11-15/recovery-artifact.txt) · [Captured events, evidence and worker logs](../deployments/custom-repair-2026-11-15/recovery-capture.json) · [Transaction record](../deployments/custom-repair-2026-11-15/recovery-transactions.json)

## Unavailable recovery and compensation

Task `repair-88996f37-1ec7-4cf6-871c-1fdec48db01a` used the same staged bundle. After its real checkpoint, the primary and recovery workers were deliberately stopped. There was no eligible bid. An attempted early failure settlement was correctly refused with `ERR_DEADLINE_NOT_REACHED`; the keeper retried after the committed deadline.

The final confirmed transfers were **0.44 NEAR refunded plus 0.10 compensation to the customer**, and **0.15 returned to the guarantor**. All 0.69 NEAR is accounted for, with no pending or failed transfers. A second failure settlement was refused with `ERR_ALREADY_SETTLED`.

The first reporting process incorrectly treated the earlier deadline refusal as an unexplained failure, after payment had already completed. The report code was fixed to retain and label the expected refusal. The job was then reconciled **read-only**, preserving its interruption history and sending no second payment. This run proves compensation after unavailable recovery. It does not prove an incorrect submitted artifact was rejected: the interrupted checkpoint was never submitted for acceptance.

[Compensation transaction](https://testnet.nearblocks.io/txns/9J4YdF61gJe6dYgKf2CfwkK8HJQzAzBsxLa4NXoNgrLU) · [Separate read-only RPC check](../deployments/custom-repair-2026-11-15/compensation.json) · [Reconciled report](../deployments/custom-repair-2026-11-15/failure-report.json) · [Transaction record including the early refusal](../deployments/custom-repair-2026-11-15/failure-transactions.json) · [Final coordinator observation](../deployments/custom-repair-2026-11-15/failure-observation.json)

The separate RPC checker was run by the same team; no independent person participated.

## Unstaged repair failure

Task `repair-7a3eb042-3f61-45ba-8b9c-7d312b974262` removed the partial milestone and injected **no outage**. The primary and beta each exhausted their bounded public-check retry. Their leases expired, and the remaining repairers declined at the available budget. No artifact was accepted. After the deadline, the contract confirmed the same **0.44 NEAR refund + 0.10 compensation**, returning 0.15 to the guarantor. The corrected reporting path completed without manual reconciliation.

[Failure settlement transaction](https://testnet.nearblocks.io/txns/CypNFavfrZHmnWsXfK1ExUVzt78JPj7kZfddtaqML7fP) · [Original unstaged task](../deployments/custom-repair-2026-11-15/unstaged-original-task.json) · [Final report](../deployments/custom-repair-2026-11-15/unstaged-original-report.json) · [Full capture](../deployments/custom-repair-2026-11-15/unstaged-original-capture.json) · [Transactions](../deployments/custom-repair-2026-11-15/unstaged-original-transactions.json)

The failed candidate sources were not retained by the workers, so their exact defects cannot be reconstructed. One separate [diagnostic live call](../deployments/custom-repair-2026-11-15/units-diagnostic.json), outside the funded trial, returned a pack count of 2 where the public case required 8 stock units. That reproduced an ambiguity in the written task: `quantity` had not explicitly named its unit. The [clarified task](../fixtures/repair/warehouse-replenishment-units.json) states that quantity is individual stock units and must equal packs multiplied by pack size. It has a new suite ID and no partial milestone. The six cases and funding policy are unchanged. Subsequent worker failures also log the actual bounded public mismatch, rather than only a generic failure message.

This is a task-definition change and a diagnostic improvement, not evidence that routing learned to outperform the fixed baseline. The original failed trial remains above.

## Clarified unstaged task

Task `repair-4a946b2f-d87a-4af9-8f76-39f8de0011dd` used the explicit-units revision, with **no partial milestone and no injected outage**. The primary passed **6/6 pinned checks**, its accepted TEE receipt was checked by the vault, and the contract paid **0.30 NEAR to alpha**, refunded **0.10 to the customer**, and paid **0.29 to the guarantor** (bond plus premium). Duplicate settlement was refused. The downloaded source matched the accepted artifact hash.

[Success transaction](https://testnet.nearblocks.io/txns/7ZdSonNvViLXAGgkN1r1y3rHfcQRjhKXTs4tvGRCKk2P) · [Submitted task](../deployments/custom-repair-2026-11-15/unstaged-units-task.json) · [Final report](../deployments/custom-repair-2026-11-15/unstaged-units-report.json) · [Delivered source](../deployments/custom-repair-2026-11-15/unstaged-units-artifact.txt) · [Capture](../deployments/custom-repair-2026-11-15/unstaged-units-capture.json) · [Transactions](../deployments/custom-repair-2026-11-15/unstaged-units-transactions.json)

Across these **four development runs**, two delivered accepted artifacts and two paid refunds and compensation. All four conserved their 0.69 NEAR inflow and refused duplicate settlement. The web client's report schema accepted all four actual reports; both successful downloads matched their hashes and both failed tasks refused artifact download. These deliberately different conditions are not a success-rate benchmark. A separate diagnostic inference call is disclosed above.

Validation of this implementation: `pnpm gate` passed **274 tests in 52 files**, both lint configurations passed, and the production web build passed with the existing bundle-size warning. The original `deployments/testnet.json` and frozen benchmark were preserved.

## What this does not establish

The coordinator and authorized verifier remain centralized. The operator funds the pilot, controls all workers and supplies the example/reference implementation. No independent customer, outside worker or outside reproduction is claimed. Acceptance means passing pinned checks and submitted challenges, not universal correctness. The deliberately partial checkpoint makes the staged task easier to recover than repairing its original source.

The latest frozen matched benchmark remains **79/80 for Backstop versus 80/80 for quote-aware fixed specialists**. These product demonstrations do not supersede that result or establish a top-two hackathon rank.
