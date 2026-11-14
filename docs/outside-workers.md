# Run a recovery worker

A repair operator can run a separate process with their own model credentials, signing key, price floor and NEAR payout account. The operator never shares their agent seed, AI key or wallet private key with the coordinator. The API verifies proof of possession of the agent key and requires bid payees to match their registrations. It does not verify wallet ownership; use a valid account you can receive funds on.

Start an isolated repair task with the built-in repair bidders disabled. The primary and challenger remain local to the demo. Use an unused output filename:

```sh
pnpm demo --task fixtures/repair/normalize-intervals.json \
  --task-id outside-intervals --external-recovery --output /tmp/outside-intervals.js
```

In a second terminal, set your own `BACKSTOP_AI_API_KEY` as you would for `pnpm demo`. Generate the worker seed once and save it privately for subsequent runs under the same name. The price floor is in NEAR per unit of estimated work (one unit per failing public case plus one):

```sh
export BACKSTOP_WORKER_SEED="$(openssl rand -hex 32)"
export BACKSTOP_WORKER_FLOOR_NEAR=0.05
pnpm worker:outside --agent outside-repair --api http://127.0.0.1:8840 \
  --task outside-intervals --account YOUR_TESTNET_ACCOUNT
```

Start the worker as soon as the API opens, before the recovery bidding window closes. On a trusted second machine, use an SSH tunnel to the coordinator's loopback API. `BACKSTOP_WORKER_RISK_BPS`, `BACKSTOP_WORKER_CAPACITY`, and `BACKSTOP_WORKER_MS_PER_UNIT` let the operator adjust when they bid or decline. The demo uses a fixture vault unless `--chain` is supplied. To pay an outside testnet address the demo must use `--chain testnet`; the account must exist on the selected network. Any testnet transaction requires authorization from the account holder.

To reserve standby instead of submitting ordinary bids, start the same worker with `--standby-price 0.52 --standby-ms 45000`. The worker signs a fixed-price commitment for each remaining recovery epoch and confirms readiness when its window opens. Use a distinct agent key and payout account per worker. You can also give different workers different OpenAI-compatible providers through `BACKSTOP_AI_BASE_URL`, `BACKSTOP_AI_MODEL`, and `BACKSTOP_AI_API_KEY`. The coordinator prevents the same registered worker from booking overlapping tasks on that coordinator. It selects a ready reservation only when no ordinary bid qualifies, and the worker must claim the usual fenced lease. Payment still requires a verified result. The reservation itself earns no fee and carries no worker-side penalty for a missed commitment. Set `BACKSTOP_STATE_PATH` to a new SQLite path when starting the demo to retain the signed events and task state.

Compare the winning signed bid, checkpoint hash, accepted artifact and vault recipient. The outside worker's signed bid carries through to the chain with its registered payout account. The demo and sandbox examples exercise separate keys and processes; they do not establish independent customer demand or participation by outside operators. The demo API uses public fixture credentials for its administrative roles. Keep it loopback-only; do not expose it as a hosted service handling real funds.

## Recorded sandbox run

On 14 November 2026, two separately launched, team-operated repairers bid 0.0625 and 0.1125 NEAR under separate signing keys for `two-bidders-testnet-1794682474`. The primary exited with `SIGKILL` after checkpointing the sorting fix. The lowest bidder verified the checkpoint, repaired the remaining boundary case using DeepSeek V4.1 Flash through NEAR AI Cloud, and submitted the [repaired source](../apps/web/public/runs/two-bidders-testnet-1794682474.js) with SHA-256 `5bbc76f5f1acf4cfc940b1533f062b40262cd11cc6c04d67e60f6f05271081bf`. The vault paid 0.0625 NEAR to `beta.backstop-6501bb.testnet` and confirmed 0.69 NEAR out against 0.69 NEAR in. The identities represent simulated operators. The inference, checkpoint handoff, and transfers occurred during the run.

[Winning assignment](https://testnet.nearblocks.io/txns/H9UPq5nEFKyKX6WrXi81zJcxXxun3kzqviKFfcwJ9tKW) · [TEE-verified acceptance](https://testnet.nearblocks.io/txns/C4poafB5X4dp6EgMj7XH3zH1NECT8Yq7H5mkaSbLeg5d) · [Settlement](https://testnet.nearblocks.io/txns/8HgG1AdGRhixabfxWsR7sPyyuefxdeJcjhemjmACUscL) · [Refused duplicate](https://testnet.nearblocks.io/txns/8dqrqfXLXHkd2Q4uSQ1uie1JumJQEjMRdh5cVvHCt1UH)

Run `pnpm web` and open [the replay](http://localhost:5210/app/runs/two-bidders-testnet-1794682474) for the auction and the primary worker's logs. Run `pnpm verify:testnet --run two-bidders-testnet-1794682474` to check the deployment, transactions, signer, and ledger from a public RPC.

`pnpm verify:recovery-replay` independently checks both bid signatures, the lowest bid against the on-chain award, the checkpoint chain, the downloaded artifact against the attested hash, and the payout recipient and amount.

## Standby settlement on NEAR Sandbox

On 14 November 2026, two team-run processes reserved 0.52 and 0.58 NEAR slots under distinct keys and confirmed availability after the primary worker exited by SIGKILL. With no ordinary bidders, the coordinator activated the 0.52 NEAR reservation. The replacement resumed from the pinned checkpoint, submitted a TEE-signed patch, and received 0.52 NEAR on Sandbox, including 0.12 NEAR from the bond. The vault confirmed 0.69 NEAR out against 0.69 NEAR in and refused a duplicate settlement. The Sandbox assignment was `12WS5nmH75NsyN66b242xj7U58s5UcmnN3g63a7kSGaf`, the TEE acceptance was `DN2q97Le82CWFvswgSkdbjocageQzNSVxioezRuponCm`, and settlement was `7tRDm5NLgNQPWpJqgv2H49ZG92rKFfwkjP6TTwY9WFsc`.
