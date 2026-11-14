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

Compare the winning signed bid, checkpoint hash, accepted artifact and vault recipient. The outside worker's signed bid carries through to the chain with its registered payout account. The demo and sandbox examples exercise separate keys and processes; they do not establish independent customer demand or participation by outside operators. The demo API uses public fixture credentials for its administrative roles. Keep it loopback-only; do not expose it as a hosted service handling real funds.

## Recorded sandbox run

On 14 November 2026, `outside-milestone` used two local processes with different keys and DeepSeek V4.1 Flash through NEAR AI Cloud. The primary fixed sorting and checkpointed source `sha256:ad4346c8cb2c…`, leaving a pinned boundary probe failing. The process exited with `SIGKILL`. The separately launched repairer took attempt 2 for 0.0625 NEAR, verified the old checkpoint hash, and produced `sha256:5bbc76f5f1acf4cfc940b1533f062b40262cd11cc6c04d67e60f6f05271081bf`. The verifier accepted the new source, both challenge probes passed, and the sandbox vault verified the receipt and confirmed 0.69 NEAR out against 0.69 NEAR in. A repeated settlement was refused as `ERR_ALREADY_SETTLED`. The repairer was operated by the team for this test.
