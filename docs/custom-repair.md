# Custom repair pilot

This flow accepts a custom dependency-free JavaScript function, runs team-operated workers with live AI, checks the artifact against pinned tests, and settles native NEAR on testnet. It was added on **15 November 2026, after the hackathon submission deadline**. The original submission and frozen benchmark remain separate evidence.

[Recorded development checks and their limitations](custom-repair-results.md) include actual recovery, compensation and the reporting failure encountered during validation.

The [hosted pilot](https://usebackstop.xyz/app/repair) accepts tasks with an operator-issued access code. The [hosted operating guide](hosted-repair.md) describes the separate worker service, persistent storage, reverse proxy and release procedure.

## Run locally

Use Node 24 and the pinned pnpm version, then `pnpm install --frozen-lockfile`. Configure these server-only values in `.env`:

```dotenv
BACKSTOP_AI_API_KEY=your-near-ai-cloud-key
BACKSTOP_TESTNET_ACCOUNT=your-funded-root.testnet
BACKSTOP_TESTNET_RPC=https://test.rpc.fastnear.com
BACKSTOP_REPAIR_ACCESS_TOKEN=your-random-access-code-at-least-32-characters
BACKSTOP_REPAIR_ORIGIN=http://localhost:5210
```

Use your own NEAR credentials under `~/.near-credentials/testnet/`; the existing testnet setup command creates or connects the vault and party accounts. The service may top up its team accounts and register a verified inference signer before running a task. Testnet funds and inference are paid by the operator. No browser wallet is charged.

Build the vault first with the repository’s supported Rust toolchain:

```sh
rustup target add wasm32-unknown-unknown
pnpm vault:build
```

The gateway disables new jobs when live AI, the testnet account or the local vault build is missing. Setup and contract prerequisites are also listed in the [testnet guide](../README.md#on-a-real-near-node).

In separate terminals, run:

```sh
pnpm repair:serve
pnpm web
```

Open `http://localhost:5210/app/repair`. Enter the repair access code, load the calendar example or paste/upload a task bundle, select the execution conditions, and submit. Do not enter a provider key or a wallet private key in the browser. The access code stays in page memory. Refreshing clears it; enter it again and use **Refresh job list** to find a running job.

The gateway listens only on `127.0.0.1:8842`. Vite proxies `/api/repair-jobs` to it. Static GitHub Pages cannot execute this backend and displays an unavailable-service explanation. For a hosted pilot, reverse-proxy only this gateway path over HTTPS, set the exact browser origin, and retain the access-code requirement. Do not expose the internal coordinator API or its demonstration signing identities.

## Task contract and outcomes

The [task format](repair-task.md) requires written rules, broken source, a reference implementation and public and held-out cases. Oracle consistency is checked in the isolated runner before a job is created or sponsored. Held-out cases are supplied by the task author and excluded from worker prompts; they are not an independent evaluation. The service supports bounded JSON functions, not arbitrary repositories, network access or package installation.

| Execution condition | Behavior                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal              | Workers attempt the full repair, without an injected outage. A partial `primaryMilestone` is refused in this mode.                                                  |
| Recovery test       | The primary process is killed after it records a checkpoint. Other team workers can bid, resume and submit a repair.                                                |
| Refund test         | After the primary checkpoint, the primary and recovery workers are stopped. The ordinary failure path runs; the vault may wait for the task deadline before paying. |

Fault tests are controlled injections, not naturally occurring outages. A supplied partial milestone deliberately makes the primary checkpoint incomplete; the [warehouse example](../fixtures/repair/warehouse-replenishment.json) is labelled and used this way. Remove that optional milestone for a normal full-repair attempt.

For normal warehouse execution, prefer the [explicit-units task](../fixtures/repair/warehouse-replenishment-units.json), which has no milestone and clarifies the distinction between pack counts and individual stock units. The earlier ambiguous task and its failure remain in the evidence.

Each job has a five-minute task deadline, up to three attempts, 0.40 NEAR escrow, 0.04 premium, 0.25 guarantor bond and a 0.10 compensation cap. Amounts are testnet NEAR. Final payment follows the contract and remaining collateral. The operator also pays inference, gas and account/storage setup; those costs are not included in escrow. One job may run at a time, with a durable limit of ten sponsored jobs per UTC day. Repeating the same request ID and payload resumes its existing job rather than funding another.

A successful job offers a download only after settlement, accepted verifier evidence and the downloaded source hash agree. Its report includes the artifact, suite and evidence hashes, check counts, transaction links and confirmed ledger totals. A failed job offers no artifact: it separately reports refund and compensation after the contract confirms its transfer callbacks. Both outcomes check that another settlement is refused.

## Evidence and interruptions

Private job inputs, source, logs and reports are under `.backstop/jobs/<job-id>/`, which is git-excluded. Normal submissions do not append to the frozen public deployment record or replay index. The access code currently grants access to all jobs on this single-operator pilot; there is no multi-customer tenancy.

An interrupted run blocks new spending. Do not delete its job directory or resubmit under a new ID to bypass that block. Check the task on the vault and reconcile its confirmed outcome first. A process failure is never shown as a refund merely because a timeout elapsed. The keeper and reporting process must remain available; this pilot does not provide highly available execution or automated disaster recovery.

For a failure settlement that already completed on-chain, stop the gateway and run `pnpm exec tsx scripts/repair-reconcile.ts --job repair-<request UUID>`. This read-only command requires the original task and complete transaction record, verifies the final refund, compensation, transfer conservation and duplicate-settlement refusal, and writes a separate reconciliation proof before marking the job complete. It preserves the original interruption status and any existing report. It never retries payments or releases an unconfirmed job; unresolved settlements require operator investigation.

For a completed failure, the public chain can be checked without signing keys:

```sh
pnpm verify:compensation --vault YOUR_VAULT.testnet --task TASK_ID \
  --duplicate-tx DUPLICATE_TX_HASH --duplicate-signer COORDINATOR.testnet \
  --output /tmp/compensation-proof.json
```

The verifier checks deployed code, actual task inflows and limits, positive compensation, exact confirmed customer/guarantor transfers, conservation, and the matching refused duplicate transaction. It does not itself establish live inference, artifact rejection or independent operators.

This pilot does not change the latest matched evaluation: Backstop **79/80**, quote-aware fixed specialists **80/80**. There is still no demonstrated routing advantage, outside operator reproduction or independent customer usage.
