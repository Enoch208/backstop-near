# Hosted repair pilot

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
| `/srv/usebackstop/current`           | Active static website release, containing `dist/`          |

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
