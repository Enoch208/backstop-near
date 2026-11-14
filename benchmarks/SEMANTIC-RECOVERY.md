# Semantic recovery and the live auction window

The primary outcome is correct delivery on the separate audit suite. Every scheduled outcome, including delivery failure, false acceptance and auction failure, is retained. No outcome-based stopping or tuning on the fresh corpus is allowed. Correctness by fault, latency, settlement cost including consumed bonds, and inference usage are secondary outcomes. A task-level result on a small public corpus cannot establish hackathon rank.

## Changes

Generic repair workers now request a concise algorithm summary and public-example checks before the single complete source block. The explanation and code together remain within the same 960-output-token benchmark cap. Diagnostics identify the first mismatching array output element and put public counterexamples before the rejected source. Existence claims require a complete witness; a specification that explicitly asks for a subsequence pattern receives pattern-state matching guidance instead of a depth/count proxy. Threshold checks call out exact equality and strict versus inclusive comparisons. No task ID or hardcoded solution is supplied to workers, and no private case is used for diagnostics. The existing TEE binding still checks the exact emitted source block against the signed response.

The original one-second ordinary-bid window remains unchanged. When it closes with no eligible ordinary or ready standby offer, the coordinator now holds for an eligible signed reservation that has not confirmed readiness. The bound is the original close time plus leaseMs + heartbeatGraceMs: 1950 additional milliseconds in this benchmark, never extended by retries. Late readiness is accepted only for the matching live reservation within that bound; ordinary bids and new reservations remain closed. Expired, excluded, busy, over-budget, wrong-epoch, or too-slow reservations cannot prolong the auction. Without an eligible reservation, failure remains immediate. No money or settlement rule changes.

The benchmark adapter treats a BID_WINDOW_CLOSED reply as an expected losing bid and continues waiting for the coordinator's actual outcome. Other unexpected responses still fail reporting. Replay checks the one-second auction window, bounded late standby readiness and the cheapest actually submitted/ready eligible quote. It does not assume an unready reservation is an available offer.

An earlier development regression used the application's existing three-second live window before the bounded-hold proposal was applied. Both arms delivered 16/16 correct outcomes, with no false acceptances. That pre-hold result is retained separately and is not the final evaluation: [pre-hold regression](semantic-regression-prehold.json), [its render monitor](semantic-prehold-load.json). The final regression and fresh run keep the original one-second window plus the tested standby hold.

Two development probes each used one bounded call on each known failing task (/132 and /81) through each provider, eight calls total outside the paired evaluation. The first probe passed three of four provider/task combinations; OpenAI's bracket implementation still failed. After adding the specification-based subsequence strategy, all four passed the acceptance and audit suites. Both probes are retained: [first probe](semantic-development-v1.json), [final probe](semantic-development-v2.json). These are development results, not fresh evidence.

## Frozen evaluation protocol

The regression uses the two known tasks /132 and /81, four fault conditions, two repetitions and both arms: 32 trials in 16 pairs. The fresh evaluation uses ten newly selected tasks, the same four conditions and two repetitions: 160 trials in 80 pairs. Both runs use three lanes, shared primary inference within each pair, and seed 560831 for block and arm order. Both arms use the same workers, public diagnostics, models, verifier, quote tiers, failure exclusions and timing.

The fresh IDs are /44, /12, /85, /138, /152, /157, /109, /59, /68 and /37. Python Random(161803) sampled the 134 IDs absent from all three preceding external corpora. The first twelve draws were 44,12,85,138,152,157,4,109,162,59,68,37. /4 was excluded because floating mean-deviation results require a tolerance policy absent from this exact-output runner; /162 requires an MD5 library unavailable in its isolated environment. These compatibility exclusions and all task selection preceded fresh inference.

The sources are the same pinned HumanEval-X JavaScript and EvalPlus v0.1.10 downloads. Inputs are ASCII and at most 1500 serialized characters, restricted to each published task domain. Integers are bounded to absolute value at most one million; base conversion uses nonnegative inputs and bases 2–9; right triangles require positive sides; cyclic rotations require distinct values; factorization uses composite n between 4 and 10000. The JavaScript base-conversion oracle omitted the zero case; it was corrected to match the Python reference before inference. Every one of the 638 selected outputs agrees with that independent Python reference. Each task has three or four public cases, 12 private acceptance cases and 48 disjoint audit cases. Public boundary probes are shared equally. The injected rejected patch contains public-example lookups only, with null otherwise.

Caps remain three model calls, 8192 prompt bytes, 960 output tokens and 4096 source bytes per call, 45 seconds per provider request and 240 seconds per task. Escrow is 0.40 NEAR, premium 0.04, bond 0.25 and capacity 0.65. Ordinary recovery quotes remain 0.28 and 0.44; standby quotes 0.52 and 0.58. Both arms choose ascending quotes within the eligible tier; strategy only breaks price ties. Leases remain 1200 ms with 750 ms grace. The original one-second bid window and maximum 1950 ms standby hold are checked during replay.

Inference is live through NEAR AI Cloud and OpenAI. Workers are team-controlled processes, and settlement is simulated. Costs include consumed bonds but exclude provider invoices, gas and standby retainers. There are no claims of outside operators or real users. The public tasks may have appeared in model training; fresh means new to this evaluation.

Video-render processes are checked before the live runs and sampled once per second throughout them. The monitor records Remotion executable paths and ffmpeg processes without saving private command arguments. General application and OS load remains possible. Any observed render activity will be disclosed; it will not justify silently removing a failed outcome. No tests, builds or code edits will run during the frozen live evaluation.


## Final regression result

The final frozen implementation hash is `sha256:d02844f655780b77ca0301249b164e1a409321ab3677bda8930770499da2c71d`. All 32 trials completed and independently replayed: 16 matched pairs, 32 audited deliveries, 13 standby activations and 13 verifier-feedback records. [Raw final regression](semantic-recovery-regression.json).

| Known bracket and threshold tasks | Backstop | Fixed specialists |
| --- | ---: | ---: |
| Correct delivery | 16/16 | 16/16 |
| Bracket task | 8/8 | 8/8 |
| Threshold task | 8/8 | 8/8 |
| Correct after rejected patch | 4/4 | 4/4 |
| Correct during provider outage | 4/4 | 4/4 |
| False acceptances | 0 | 0 |
| p95 seconds | 71.348 | 36.934 |
| Settlement NEAR per correct result | 0.397500 | 0.391250 |
| Consumed bonds, NEAR | 0.64 | 0.66 |

The previously failing semantic tasks completed successfully in every scheduled regression trial. Correctness tied in all 16 pairs; the first recovery worker matched in all pairs, and complete assignment sequences matched in 12. This is successful development regression evidence, not a market advantage. Backstop's slowest cases needed additional recovery time; all failed attempts remain in the timing and usage totals. The separate API/core tests exercise deliberately delayed readiness and the fixed grace bound, while live outcomes measure the whole recovery path without an artificial readiness delay.

```sh
pnpm benchmark:standby --external --routed --hardened --contract-checks --semantic-regression --verify benchmarks/semantic-recovery-regression.json
pnpm benchmark:standby --external --routed --hardened --contract-checks --semantic-regression --lanes 3 --repeats 2 --out /tmp/backstop-semantic-regression-repeat.json --state /tmp/backstop-semantic-regression-repeat
```


## Fresh evaluation result

The single fresh run completed all 160 scheduled trials on 14 November 2026 without any rerun or reporting recovery. Independent replay checked 80 matched pairs, all 160 delivered artifacts, 40 standby activations, 40 feedback records, signed assignments, paired checkpoints, budgets and settlement conservation. Regression and fresh results share the frozen implementation hash above. [Raw fresh results](semantic-recovery-fresh.json).

| Fresh tasks, all conditions | Backstop | Fixed specialists |
| --- | ---: | ---: |
| Correct delivery | 80/80 | 80/80 |
| Correct after rejected patch | 20/20 | 20/20 |
| Correct during provider outage | 20/20 | 20/20 |
| Correct after worker crash | 20/20 | 20/20 |
| False acceptances | 0 | 0 |
| p95 seconds | 33.470 | 35.868 |
| Total simulated settlement cost, NEAR | 30.40 | 30.40 |
| Settlement NEAR per correct result | 0.380000 | 0.380000 |
| Consumed bonds, NEAR | 2.40 | 2.40 |

Correctness and settlement cost tied. Backstop's observed p95 was 2.398 seconds (6.7%) lower, but worker assignment sequences were identical in all 80 pairs. Recovery inference is independent between arms; this sample does not establish a routing or consistent latency advantage. There were zero paired correctness wins and zero losses. The identical tools and cheaper-first ordering benefit the fixed baseline as well. The changes resolved the scheduled known-task regressions and produced perfect correctness on this new task sample; they do not demonstrate general perfection, production reliability or a number-one hackathon rank.

The [render monitor](semantic-recovery-load.json) contains 694 samples from 21:57:05 through 22:09:23 UTC, spanning both final runs. No Remotion or ffmpeg processes were observed. General OS/application load was not excluded. Neither live run had a standby-ready event later than the ordinary bid deadline: the deliberately delayed-readiness behavior is demonstrated by the API/core tests, not by a naturally late readiness event in this fresh run. No live auction failures occurred.

| Run and arm | Calls charged | Prompt tokens | Output tokens | Calls missing usage |
| --- | ---: | ---: | ---: | ---: |
| Regression, Backstop | 31 | 35015 | 9254 | 0 |
| Regression, fixed | 31 | 35132 | 8271 | 0 |
| Fresh, Backstop | 140 | 131840 | 22955 | 1 |
| Fresh, fixed | 140 | 131840 | 23251 | 1 |

Shared primary requests are charged to each arm. The fresh missing-usage entry was one shared primary provider timeout, not two separate requests. The regression retained one invalid/truncated Backstop response. Provider bills were not reconciled; the settlement table excludes those bills, gas and standby retainers. The task sets differ from earlier evaluations, so 78/80 versus 80/80 is not a controlled before/after effect estimate.

```sh
pnpm benchmark:standby --external --routed --hardened --contract-checks --fresh-semantic --verify benchmarks/semantic-recovery-fresh.json
pnpm benchmark:standby --external --routed --hardened --contract-checks --fresh-semantic --lanes 3 --repeats 2 --out /tmp/backstop-semantic-fresh-repeat.json --state /tmp/backstop-semantic-fresh-repeat
```

## Validation

All 188 automated tests in 41 files passed before the frozen final runs. Full workspace/root TypeScript checks and scoped lint/format checks passed. The added core tests cover delayed readiness, the fixed grace bound, ordinary-bid closure, immediate assignment of an existing offer, and absent, expired, excluded, busy, over-budget, wrong-epoch or too-slow standby reservations. The API test exercises delayed readiness through signed requests and keeper ticks with persisted state. Neither the recorded source nor the benchmark configuration was edited during the final regression or fresh evaluation. Benchmark artifacts are excluded by the repository formatter configuration.

The final full repository gate passed TypeScript checking and stopped at the same nine existing lint errors in unrelated recorded-replay/demo and earlier benchmark files. Scoped checks remain green; changes are local and uncommitted. A final scan of 40 changed source/evidence files found no occurrences of the two configured API secrets. The current evaluation-file hash matches both final reports.
