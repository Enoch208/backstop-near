# Hosted repair pilot

[Open the hosted pilot](https://usebackstop.xyz/app/repair). An operator-issued access code is required to submit tasks or read job history.

The live pilot uses the same custom-task gateway as the [local flow](custom-repair.md), behind HTTPS and an operator-issued access code. It runs live inference with team-controlled workers and operator-funded native NEAR testnet settlement. It has no customer wallet billing or independent operators. The scripted interactive demo remains a separate service.

## Deployment layout

The Linux host uses Node 24 and pnpm 10.33.0. A release is an archive of a tested Git commit, installed with `pnpm install --frozen-lockfile`, with a production web build and the `outcome-vault-wasm` artifact from that commit's successful CI run. Installing a WASM file does not upgrade the existing onchain vault.

| Path                                 | Purpose                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| `/srv/usebackstop/releases/<commit>` | Root-owned release source and dependencies                 |
| `/srv/usebackstop/repair-current`    | Symlink to the active repair release                       |
| `/var/lib/usebackstop-repair`        | Persistent, private job state and testnet credentials      |
| `/etc/usebackstop/repair.env`        | Root-readable provider configuration and pilot access code |
| `<release>/.backstop`                | Symlink to the persistent state directory                  |
| `/srv/usebackstop/web-current`       | Active static website release, containing `dist/`          |

Use a dedicated `usebackstop-repair` system user. Install [the service unit](../ops/usebackstop-repair.service) under `/etc/systemd/system/`. Systemd gives it a writable private state directory, a read-only application and filesystem, process/memory/CPU limits, and kills the entire worker group on shutdown. Keep testnet keys under `/var/lib/usebackstop-repair/.near-credentials/testnet/`, owned by that user, with directory mode 0700 and file mode 0600. Copy only this pilot's account keys, never mainnet or unrelated project keys.

The root-owned mode-0600 environment file requires `BACKSTOP_AI_API_KEY`, `BACKSTOP_TESTNET_ACCOUNT` and `BACKSTOP_REPAIR_ACCESS_TOKEN` (at least 32 random characters). It may also set the existing AI base URL/model and testnet RPC. Systemd sets the exact browser origin to `https://usebackstop.xyz`. Never put credentials in source archives, web assets, command arguments or deployment output. Access-code holders share this single-operator pilot's job history; issue access only to trusted participants.

Include [the proxy locations](../ops/repair-nginx.conf) inside the HTTPS site server block. The gateway binds only to loopback. The public path permits GET, POST and OPTIONS; the coordinator's existing public routes remain read-only. The gateway itself checks authorization, exact browser origin, task schema and oracle consistency before sponsorship. Keep authentication enabled.

## Update without losing jobs

1. Run the repository gate and web build, commit and push. Wait for the commit's CI before installing its release and WASM artifact.
2. Check the private job list. Do not deploy while a job is running or interrupted. Coordinate maintenance with access-code holders; temporarily refuse POST at the reverse proxy before checking again and stopping the service. A state file marked running after restart is treated as interrupted, never automatically paid again.
3. Preserve the shared state directory, environment and keys. Link the new release's `.backstop` to the existing state directory. Switch `repair-current` atomically and start the service. Do not start a second local gateway using the same funding accounts.
4. Check `systemctl is-active usebackstop-repair` and `/api/repair-jobs/config`. Confirm unauthenticated job requests return 401, an incorrect browser origin returns 403, and authenticated reads return the existing history. These checks spend no funds.
5. Switch the static website release atomically. Run `nginx -t` before reloading its configuration and restore POST access after the checks pass. Record the deployed commit and any funded smoke run separately.

For rollback, retain the previous release targets and point both symlinks back after pausing submissions and confirming no active task. Never roll back the state directory, delete interrupted jobs or reset the daily cap. If a task was interrupted, investigate its chain state and use the documented read-only reconciliation procedure where applicable before accepting new work.

Public config reports configured availability, not a balance guarantee or successful provider probe. A funded smoke run is required to demonstrate actual remote inference and settlement. The ten-jobs-per-UTC-day limit survives deployments because it is derived from persistent job records. Inference, gas and storage costs are additional operator costs. Systemd restarts the gateway; it does not resume an interrupted onchain task automatically.

## Recorded hosted smoke run

On 15 November 2026, release `37bfa860156f409491362b539a91978708a0d05e` was deployed to the VPS after its quality, contract and local-chain CI jobs passed. GitHub Pages was also redeployed; Pages remains a static evidence site and cannot execute the worker service.

The calendar task was submitted through the public HTTPS API with no partial milestone and no injected outage. Task `repair-915fe2ee-5b7f-4f68-aae1-ad701fe100af` completed with **4/4 pinned checks**, two challenger probes without a counterexample, and vault-checked TEE provenance. The contract confirmed **0.30 NEAR to alpha, 0.10 back to the customer and 0.29 to the guarantor**. Total inflow and confirmed outflow were both 0.69 NEAR, with no pending or failed transfers. Duplicate settlement was refused.

[Settlement transaction](https://testnet.nearblocks.io/txns/ALhD69pGprKa7NFzc1SZaeuN9heZTStj7iUnupot29Kd) · [Task](../deployments/hosted-repair-2026-11-15/task.json) · [Final report](../deployments/hosted-repair-2026-11-15/report.json) · [Transactions](../deployments/hosted-repair-2026-11-15/transactions.json) · [Delivered source](../deployments/hosted-repair-2026-11-15/artifact.txt) · [Read-only verification](../deployments/hosted-repair-2026-11-15/verification.json)

The downloaded artifact matched its accepted hash. The four earlier completed jobs were migrated, and all five remained completed and readable after a controlled service restart. Public requests without the access code returned 401; an incorrect origin returned 403; invalid tasks returned 400; repeating the original request returned the same job without new funding. Public writes to the internal coordinator remained refused. The browser displayed the available live service; the funded submission itself used the HTTPS API, not manual browser interaction.

The sponsor was replenished with [1 testnet NEAR recycled from the team's beta account](../deployments/hosted-repair-2026-11-15/sponsor-refill.json). This is a separate operational transfer, not customer revenue or another task payout. All workers, accounts and checks remain team-controlled. This run demonstrates hosted execution, not a new recovery benchmark or independent adoption. The earlier recovery and compensation proofs remain in the [custom-repair results](custom-repair-results.md). These are post-deadline development results.
