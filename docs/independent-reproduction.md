# Independently reproduce the evidence

An outside reviewer can check Backstop without a wallet, API key, private signing key or `.env` file. These commands replay published evidence and read public services. They do not buy inference, submit transactions or create a new live benchmark.

A team member running this procedure is a team reproduction. An independent reproduction requires someone outside the team to run it on their own machine, identify their relationship to the project, and provide their own observations. Neither kind establishes independent worker participation or real customer usage.

## Start from the public source

Install **Node 24** and **pnpm 10.33.0**, then use a new directory:

```sh
git clone https://github.com/Enoch208/backstop-near.git
cd backstop-near
node --version
pnpm --version
git rev-parse HEAD
git status --porcelain
pnpm install --frozen-lockfile
```

Record the full commit SHA and tool versions. If reviewing a specific revision, check it out before installing. The recorded benchmark needs both its source files and `benchmarks/bounded-recovery-fresh.json`. If the public revision lacks them or rejects `--fresh-bounded`, report that revision as blocked; do not substitute local team files and call it a clean public reproduction.

Keep complete stdout, stderr and exit status for each command, including failures. Save logs outside the clone so the source stays clean. For example:

```sh
BACKSTOP_REPRO_LOGS=$(mktemp -d)
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$BACKSTOP_REPRO_LOGS/started-at.txt"
pnpm judge > "$BACKSTOP_REPRO_LOGS/judge.log" 2>&1
printf '%s\n' "$?" > "$BACKSTOP_REPRO_LOGS/judge.exit"
cat "$BACKSTOP_REPRO_LOGS/judge.log"
```

## Run the checks

Run these from the repository root, saving each command's log and exit status separately:

```sh
pnpm judge
pnpm episode recovery
pnpm episode exhausted
pnpm judge --network
pnpm benchmark:standby --external --routed --hardened --contract-checks --diversify --bounded --fresh-bounded --verify benchmarks/bounded-recovery-fresh.json
pnpm gate
git status --porcelain
```

| Command                    | Expected evidence and limits                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm judge`               | **11 of 11 claims hold** for the current evidence. Runs the local state machine, fixture ledger, verifier and recorded enclave-attestation checks. The scripted arena claim is separate from the live-provider comparison below.                                                                                                                                                                                                        |
| `pnpm judge --network`     | Adds read-only NEAR testnet checks for deployment, transactions, ledgers, signer and recorded inference. Normally **16 total claims**; a record containing role-key restrictions adds another. Record the actual outcome, including RPC failures or changed chain state. No credentials or transaction signing are needed.                                                                                                              |
| Bounded `--verify` command | Downloads checksum-pinned public HumanEval/EvalPlus datasets, reconstructs tasks and checks the recorded outputs, bids, checkpoint provenance, budgets and settlements. Internet access is required; no provider calls are made. Expected: **160 trials, 80 pairs, Backstop 79/80 correct, fixed specialists 80/80, zero Backstop-only wins and one fixed-only win**. This result does **not** show Backstop beating fixed specialists. |
| `pnpm gate`                | Runs the checked-out typecheck, lint, formatting and TypeScript tests. Report observed counts and failures; test counts can change between revisions. It does not run the Rust contract suite.                                                                                                                                                                                                                                          |

`pnpm episode recovery` should finish SETTLED with 0.69 NEAR in and confirmed out. `pnpm episode exhausted` should finish FAILURE_SETTLED: 0.54 to the customer (0.40 escrow + 0.04 premium + 0.10 compensation), and 0.15 to the guarantor. Both commands are explicitly scripted fixtures with a simulated vault; no NEAR moves. The recorded [testnet recovery](https://usebackstop.xyz/app/runs/two-bidders-testnet-1794682474) and [testnet refund](https://usebackstop.xyz/app/runs/recovery-red-team-mwgrr0y8) have actual transaction links. The testnet refund record paid 0.05 NEAR and zero compensation.

The benchmark used team-controlled workers, live inference and simulated settlement. Its modules share components, and repeated trials are correlated. Replay checks recorded evidence; it does not establish that a fresh live run will have the same results. See the [full protocol, results and limitations](../benchmarks/BOUNDED-RECOVERY.md).

## Return your observation

Complete this record after running the commands; leave unrun items explicitly marked **not run**:

```text
Reviewer name or public handle:
Relationship to the project:
UTC date and time:
Repository URL and full commit SHA:
Operating system / architecture:
Node / pnpm versions:
Clean clone and frozen-lockfile install outcome:
Exact commands, exit statuses and unedited log filenames:
Judge result:
Read-only network result:
Bounded replay result:
Test-suite result:
Source changes, missing files, errors or other issues:
What I verified directly / what I did not verify:
```

Share the observations and unedited command logs through your chosen public issue or review channel. Do not include environment dumps, private keys or credentials. Preserve failed attempts when retrying; record why and when you retried. A missing artifact, failing assertion or unavailable public endpoint is a finding, not a passing reproduction.
