# Contract checks and price-first recovery

This evaluation follows the earlier rejected-patch experiment. Its primary endpoint is correct delivery on the separate audit cases. Secondary endpoints are false acceptance, correctness by fault, p95 elapsed time, settlement cost per correct delivery, consumed bonds and inference usage. The complete scheduled run is retained regardless of which arm leads. There is no outcome-based stopping or fresh-corpus tuning.

## Changes under test

The auction now sorts eligible bids by price before strategy. Strategy preference breaks price ties only. A rebuild label alone cannot justify a premium. Existing failure exclusions, deadlines, standby eligibility and recovery capacity remain enforced. A more expensive worker can still be selected after cheaper workers fail or become unavailable. No calibrated evidence currently justifies a strategy premium.

Before generating a repair, both normal workers and benchmark workers run the current checkpoint against the public tests. They receive up to three compact, concrete public counterexamples. The preflight includes the existing isolated runner's one-second suite budget, 8 MiB memory limit and bounded stack. Cases skipped because an earlier test exhausted the suite budget are not presented as independent semantic failures. Preflight time is included in the benchmark's primary elapsed time and in recovery wall time. Hidden acceptance and audit inputs remain withheld.

A repeated set of public failures now triggers a fresh implementation even when an agent changes the source text. A crash is distinguished from verifier rejection. The earlier protections remain: rebuild omits rejected source, arguments have explicit nested shapes, local retries receive their own failed source, and normal workers refuse patches that still fail public checks after their bounded retry. The benchmark uses one inference call per assignment, preserving the same three-call task cap.

Task authors must pin appropriate boundary and resource tests. These checks do not prove performance or semantics for arbitrary unseen inputs. For development, new public checks cover a revisitable 80-cell grid path, noncontiguous nested brackets, and stripping spaces from returned parenthesis groups. The bracket check includes a minimized counterexample learned from a previous audit; that development corpus is not fresh. The new grid check rejects the previously accepted exhaustive-path implementation before success settlement.

## Fresh corpus and protocol

The ten fresh IDs are HumanEval/54, /78, /81, /29, /34, /86, /87, /147, /52 and /48. They are the first ten IDs in a Python Random(314159) sample from the 144 IDs not used in the preceding two live external corpora. Selection preceded inference. Sources remain the pinned HumanEval-X JavaScript and EvalPlus v0.1.10 downloads used in earlier evaluations.

Inputs are filtered to the stated task domains: strings, numeric arrays, GPA bounds, ragged integer rows, uppercase hexadecimal digits, or ordinary-space-separated words as appropriate. This excludes, for example, a string where the prefix-filter task requires a list of strings. Dataset inputs are ASCII and at most 1500 serialized characters. Triple-counting dataset cases use n up to 200, with a separately authored public resource case at n=700 within the published n<=1000 contract. The JavaScript coordinate oracle's tuple syntax was corrected to produce arrays. The triple-count oracle uses an equivalent residue-count formula so the oracle itself stays within the execution budget. All 639 selected outputs, including public probes, agree with the independent upstream Python references before any model inference.

Each task has three or four public cases, twelve hidden acceptance cases and 48 disjoint audit cases. Additional public cases were authored from the specification and shared equally with both arms. The rejected-output injection is a lookup containing only these public inputs and outputs, with null for other inputs. It contains no oracle or hidden input. These public datasets may have appeared in model training; fresh means new to this live evaluation.

The fresh run uses ten tasks, four fault conditions, two repetitions and two arms: 160 trials in 80 matched pairs. The development regression uses the four known tasks /119, /129, /132 and /1: 64 trials in 32 pairs. The prior seed 560831 randomizes block and arm order. Primary inference is shared within each pair; recovery calls are independent. Both arms use the same two live inference providers, improved workers, public diagnostics and task suite.

Limits are unchanged: three inference calls per arm, 8192 prompt bytes and 960 output tokens per call, 4096 source bytes, a 45-second provider request timeout and 240-second task wall limit. Escrow is 0.40 NEAR, premium 0.04, bond 0.25 and recovery capacity 0.65. Ordinary quotes remain 0.28 and 0.44; standby quotes remain 0.52 and 0.58. Fixed specialists keep ascending quoted price within ordinary and standby tiers. Both have the same 1200 ms lease and 750 ms heartbeat grace. Settlement is simulated; reported settlement cost includes consumed bonds and excludes provider bills, gas and standby retainers. Workers are team-controlled child processes with distinct signing keys, not independent outside operators.

The implementation hash and corpus hash are recorded before inference. Replay checks signed awards, paired checkpoints, three-call and output limits, ledger conservation, bond caps, and the cheapest remaining quote within the eligible tier. Since the new auction and fixed order often select the same worker, differences caused by independent inference are not evidence of a routing advantage. None of these results establishes a hackathon ranking.


## Development regression result

The frozen implementation is `sha256:8071010ab69e7615b1ff7efd2c2d6472ed0807d0e2bfa6b841b2359fe3fb25e8`. The regression completed all 64 trials in 32 matched pairs on 14 November 2026, using two lanes. Independent replay reran all 52 delivered artifacts and verified 21 standby activations, 46 feedback records, signed assignments, call limits, cheapest eligible quotes, bond caps and conservation. [Raw regression results](contract-recovery-regression.json).

| Known tasks, all conditions | Backstop | Fixed specialists |
| --- | ---: | ---: |
| Correct delivery | 25/32 | 27/32 |
| Correct after rejected patch | 5/8 | 6/8 |
| Correct during provider outage | 6/8 | 6/8 |
| False acceptances | 0 | 0 |
| p95 seconds | 60.699 | 55.282 |
| Total settlement cost, NEAR | 10.77 | 11.09 |
| Settlement NEAR per correct delivery | 0.430800 | 0.410741 |
| Consumed bonds, NEAR | 1.85 | 1.61 |

Backstop lost two pairs and won none. Both arms chose the same first recovery worker in all 32 pairs; complete assignment sequences matched in 29. Both solved all eight whitespace (/1) and all eight parenthesis-concatenation (/119) trials. Grid paths (/129) were 7/8 for Backstop and 8/8 for fixed. Nested bracket subsequences (/132) remained 2/8 and 3/8 respectively. Backstop's rejected-output grid miss generated code that prohibited revisiting the minimum cell and then a replacement with invalid path construction. The failing bracket implementations continued to treat the problem as contiguous depth instead of finding a valid subsequence. These are model repair failures, not eliminated by the new feedback prompt.

The new acceptance checks removed the observed false acceptances in this run, but did not make the hard tasks reliably repairable. The earlier grid audit failure is now a published resource rejection rather than a paid success. The regression is development evidence because its added checks include earlier failure information; it cannot establish improvement on fresh tasks. No source, worker, prompt, routing or limit was changed after this regression began.

| Regression inference usage | Calls charged | Prompt tokens | Output tokens | Calls missing usage |
| --- | ---: | ---: | ---: | ---: |
| Backstop | 67 | 60106 | 14291 | 2 |
| Fixed specialists | 66 | 58828 | 13742 | 2 |

Shared primary inference is charged to each arm. The two timeout entries per arm refer to the same paired primary timeouts, not four separate provider requests. Provider bills were not reconciled.

```sh
pnpm benchmark:standby --external --routed --hardened --contract-checks --regression --verify benchmarks/contract-recovery-regression.json
pnpm benchmark:standby --external --routed --hardened --contract-checks --regression --lanes 2 --repeats 2 --out /tmp/backstop-contract-regression-repeat.json --state /tmp/backstop-contract-regression-repeat
```


## Fresh evaluation result

The single fresh evaluation completed 160 actual trials in 80 matched pairs on 14 November 2026, using three lanes and the same frozen implementation hash as the regression. Replay independently checked all 156 delivered artifacts, 45 standby activations, 52 feedback records, signed awards, paired checkpoints, budgets and settlement conservation. [Raw fresh results](contract-recovery-fresh.json).

| Fresh tasks, all conditions | Backstop | Fixed specialists |
| --- | ---: | ---: |
| Correct delivery | 78/80 | 78/80 |
| Correct after rejected patch | 20/20 | 20/20 |
| Correct during provider outage | 19/20 | 18/20 |
| Correct after worker crash | 19/20 | 20/20 |
| False acceptances | 0 | 0 |
| p95 seconds | 31.440 | 25.785 |
| Total settlement cost, NEAR | 29.80 | 29.56 |
| Settlement NEAR per correct delivery | 0.382051 | 0.378974 |
| Consumed bonds, NEAR | 2.68 | 2.56 |

Backstop did not beat the fixed baseline: correct delivery tied, p95 was 21.9% higher, and settlement cost per correct delivery was 0.8% higher. Each arm alone succeeded in one pair. Complete assignment sequences matched in 78 pairs. There were no different first-recovery choices where both arms reached recovery. The observed differences do not establish a routing advantage.

Both arms failed the first GPA (/81) provider-outage repetition by repeatedly using inclusive comparisons where the published rules require strict thresholds. Fixed also failed the second repetition; Backstop succeeded there. Backstop's other miss was the hexadecimal-count (/78) worker-crash repetition: its one-second recovery auction closed with no eligible bids before readiness and bid requests arrived. These are unresolved semantic and availability failures. More detailed prompts and rebuilds have not eliminated repeated algorithm mistakes. No wrong artifact received success settlement in this evaluation.

### Retained reporting failure

The process exited after exporting 159 rows when a late bid returned HTTP 409. Inspection of the durable event log showed the missing Backstop /78 trial had already reached FAILURE_SETTLED with NO_ELIGIBLE_BIDS. It was a real task failure, not an invalid trial to discard. The 160th row was reconstructed by replaying the persisted events through the existing event reducer, retaining its actual transfers and timestamps. Its sole primary inference was recovered from the matching fixed row, as the paired protocol shares that exact request; its source digest matched the persisted primary checkpoint. No model request or trial was rerun.

The complete [event stream for the recovered failure](contract-recovery-reporting-failure.json) and a `reportRecovery` provenance field are retained. The independent report verifier passed on all 160 rows. After evaluation, the reporter was changed to tolerate a 409 only once the task has entered terminal failure or its failure-settlement states, then export the failed outcome normally. Other unexpected bid responses still throw. This reporting-only fix postdates the recorded implementation hash; worker, task, routing and budget code remained frozen throughout evaluation. The one-second auction availability problem itself remains unresolved.

| Fresh inference usage | Calls charged | Prompt tokens | Output tokens | Calls missing usage |
| --- | ---: | ---: | ---: | ---: |
| Backstop | 144 | 118324 | 14604 | 1 |
| Fixed specialists | 146 | 119934 | 15188 | 1 |

Token totals cover reported usage only, with shared primary inference charged to both arms. Settlement remains simulated and excludes inference invoices, gas and standby retainers. These are ten public-dataset task adaptations and team-controlled operators, not independent real-user workloads. Neither the fresh tie nor the hard-task regression loss supports a consistent reliability lead or a number-one hackathon claim.

```sh
pnpm benchmark:standby --external --routed --hardened --contract-checks --fresh-contracts --verify benchmarks/contract-recovery-fresh.json
pnpm benchmark:standby --external --routed --hardened --contract-checks --fresh-contracts --lanes 3 --repeats 2 --out /tmp/backstop-contract-fresh-repeat.json --state /tmp/backstop-contract-fresh-repeat
```


## Validation and limits

All 175 automated tests in 40 files passed after the reporting fix. Full workspace and root TypeScript checks passed. Scoped lint, including the local no-comments rule, and formatting checks passed for changed source files. Benchmark artifacts are excluded by the repository formatter configuration. A scan of 28 changed files found no occurrences of the two configured API secrets. The repository-wide gate stopped at nine existing lint errors in unrelated replay/demo and earlier benchmark files; no commit was made.

Latency was measured on shared hardware, not an isolated benchmark host. Video-render processes observed during validation had started at 21:32 UTC, overlapping the latter part of the fresh run, including the failed auction around 21:34 UTC. This is a possible load confound, not proof of the cause of that failure. The observed failure remains counted, and p95 differences should not be interpreted as a controlled causal effect of routing. A production reliability claim needs load-isolated repetitions and independent operators as well as better repairs.


The availability failure received a subsequent bounded-standby-hold fix described in [the next evaluation](SEMANTIC-RECOVERY.md). It postdates this recorded implementation hash and does not change the 78/80 result or remove the /78 failure.
