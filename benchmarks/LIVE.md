# Live model recovery benchmark

The evaluation measures correct delivery of the same JavaScript repair task under three schedulers. Each scheduler gets the same model, public examples and deterministic test runner. The primary outcome is correct completion by the deadline, as measured by cases withheld from the model and the acceptance gate. The trial data include invalid acceptances and unresolved tasks.

```sh
pnpm benchmark:live --verify-corpus
pnpm benchmark:live --verify-run benchmarks/market-results.json
pnpm benchmark:live --pilot --out /tmp/backstop-live-pilot.json
pnpm benchmark:live --repeats 3 --out /tmp/backstop-live-results.json
```

The corpus and run verification commands require no credentials. The run check confirms complete pairings and reruns accepted artifacts against both sets of cases. Live runs use `BACKSTOP_AI_API_KEY` and honor `BACKSTOP_AI_MODEL` and `BACKSTOP_AI_BASE_URL`. The current full matrix uses eight hand-authored tasks, five conditions and three schedulers. It attempts up to 360 model calls per repeat. The pilot uses the first two tasks and attempts up to 90 calls. A provider may charge for requests that fail. Keep the output path distinct from any earlier record you want to preserve. The runner updates the file after each trial and includes the expected and completed trial counts.

Each task specifies a single JavaScript function and ships with a faulty starting implementation. The corpus contains payout splitting, time interval calculations, stock allocation, discounts, route matching, analytical bucketing, CSV parsing and event reconciliation. The test runner derives expected outputs from a reference implementation and first checks that implementation against hand-calculated anchors. It verifies each broken starter and the incorrect candidate before making model calls. The corpus digest identifies the exact cases and reference implementations. These are deliberately small benchmark tasks. Their overlap with any provider's training data is unknown.

| Scheduler | Recovery behavior                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `single`  | The same agent retries from the best available checkpoint with public failure outputs and the history of earlier failures. It may produce a different attempt each time.                                                                                                 |
| `fixed`   | A fixed sequence assigns the next available specialist. It uses the same specialists, diagnostic tool, checkpoint and failure history that the market can use.                                                                                                           |
| `market`  | Backstop's recovery pricing checks available capacity, public failures, failure history and remaining time. The harness submits signed offers from the existing roster, applies coalition consent, and uses the actual auction code to choose the lowest eligible offer. |

All three get at most three model requests, at most 8,192 serialized prompt bytes per request, at most 960 provider output tokens per request, and the same 240-second trial limit. Each individual model request has a 45-second timeout within that limit. Output length is requested from the provider and checked against reported usage when available. The same deterministic public diagnosis is available in every mode, so the market receives no hidden inputs or extra inference for diagnosis. Specialist prompts differ by worker. This comparison measures the full scheduling policy, including worker choice, prompt choice, eligibility and payout pricing. To attribute a difference specifically to the price ranking, a further ablation would need to keep worker eligibility and consent fixed while swapping only the ranking function.

| Condition          | What changes on the first attempt                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `healthy`          | No injection. The submitted model output goes to verification.                                                                                              |
| `transient-tool`   | The result is lost after inference. The model charge is counted and the scheduler can retry.                                                                |
| `worker-death`     | The candidate remains in the checkpoint, then the worker disappears before submission. A replacement or restarted single agent can build on that candidate. |
| `incorrect-output` | The candidate is replaced with a task-specific bug that passes the public examples. Verification or the independent audit detects the mismatch.             |
| `constrained-recovery` | After the primary loses its result, its group becomes unavailable. Both specialist schedulers see the same seeded group outage and quotes. |

Trials are paired by task, condition and repeat. The seed shuffles the paired blocks and mode order within each block. Provider outputs can still vary between runs. Acceptance uses the public cases and a separate hidden set. Final correctness requires acceptance and passing a third audit set. The model receives the public cases and notice of a private-test failure, while the private inputs stay in the harness. The verifier and audit both run the user function in the same isolated JavaScript runner.

The report includes correct delivery, incorrect acceptance, unresolved work, median and 95th-percentile elapsed times, model request counts, provider-reported tokens, simulated payouts and compensation, and paired market differences. Cost per correct delivery counts customer charges for all trials, including incorrect results. Compensation is reported separately. Model usage is measured in provider-reported tokens. A request missing usage contributes to call counts and makes tokens per correct delivery unavailable. Payments are simulated with Backstop's ledger planner, so `customerNearBeforeCompensationPerCorrect` measures the assumed escrow cost, not an invoice for inference or an observed blockchain charge. The paired intervals bootstrap by distinct task so repetitions and fault scenarios on the same task are kept together. With this small corpus they remain exploratory, and a zero-width interval can occur when every observed pair ties.

This benchmark runs the scheduler, pricing, coalition consent, acceptance and ledger planner in one process. Its fault injection is at that process's candidate boundary. Worker signals and lease timing, API restarts, open-ended challengers, provider model diversity, TEE attestation and executed NEAR settlement require separate experiments. Only two distinct tasks contribute to the pilot. A result that ties either baseline gives no observed completion advantage for the market on those tasks.

## Recorded pilot

On 14 November 2026, the pilot used `deepseek-ai/DeepSeek-V4.1-Flash-1017` through NEAR AI Cloud. Each scheduler delivered eight correct repairs across two tasks and four conditions. The 42 model responses all reported token usage. The market had zero paired wins and zero losses against either baseline. It used 956 tokens per successful repair versus 966.75 for persistent retries and 953.875 for the fixed workflow. The results and delivered source are in [live-pilot.json](live-pilot.json).

## Full recorded comparison

The full run on 14 November 2026 used the same model, with one repeat for each of eight tasks, four conditions and three modes. Offline verification checked all 96 pairings and independently reran all 92 delivered artifacts. Of 32 trials per mode:

| Mode                     | Correct | Incorrect accepted | Unresolved | Tokens per correct repair |
| ------------------------ | ------: | -----------------: | ---------: | ------------------------: |
| Persistent single agent  |      29 |                  1 |          2 |                     1,215 |
| Fixed specialists        |      30 |                  1 |          1 |                     1,129 |
| Backstop recovery market |      30 |                  1 |          1 |                     1,147 |

The market had one more correct outcome than persistent retries, and tied fixed specialists on every paired correctness result. The exploratory task-level interval for the difference against retries was 0 to 9.375 percentage points. The matched modes also accepted the same discount-task mutant, which the separate audit caught. This shows where to improve acceptance coverage and does not establish a reliability advantage over fixed scheduling. All [raw trial results](live-results.json), including the incorrect acceptances and unsuccessful cases, are available. Verify with `pnpm benchmark:live --verify-run benchmarks/live-results.json`.

## Recorded comparison with constrained recovery

The 120-trial follow-up used the same model over eight tasks. It moved the known discount rounding counterexample into the acceptance gate and added a fresh discount case to the audit. Recovery quotes and group availability were shared by fixed and market schedulers. Fixed selected the first eligible specialist in its sequence. The market selected the lowest eligible signed offer. The group outage and quotes were simulated, and inference ran through one live provider.

| Mode | Correct | Incorrect accepted | Unresolved | Tokens per correct repair | p95 seconds | Simulated customer NEAR per correct repair before compensation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Persistent single agent | 37/40 | 0 | 3 | 1,249 | 10.30 | 0.4065 |
| Fixed specialists | 37/40 | 0 | 3 | 1,177 | 10.83 | 0.2537 |
| Backstop recovery market | 38/40 | 0 | 2 | 1,146 | 13.68 | 0.2571 |

Under the constrained condition, the market delivered 8/8 correct repairs and both baselines delivered 7/8. Across all 40 paired cases, the market won one and lost zero against fixed specialists. Its estimated improvement was 2.5 percentage points, with an exploratory task-cluster interval of 0 to 7.5 points. The market's p95 time and simulated customer cost per correct repair were higher than fixed specialists'. The small, single-model sample leaves the general reliability difference unresolved. The offline verifier checked all 120 trials and reran the 112 delivered artifacts. [Raw results and artifacts](market-results.json)

## Matched run on eight fresh tasks and two inference providers

Run `pnpm benchmark:live --verify-run benchmarks/held-out-results.json` to verify the 240 trials and rerun all 213 delivered artifacts. The run used DeepSeek V4.1 Flash through NEAR AI Cloud and GPT-4.1 mini through OpenAI. Each block shares the first model response, its latency, recovery price floors, and the outage across all schedulers. Public examples and specifications went to the models. References, acceptance cases, and the separate audit cases stayed in the harness. Under the injected provider outage, both specialist schedulers could use OpenAI and persistent retries had no available worker. No inference provider was taken offline.

| Mode | Correct | Incorrect accepted | Unresolved | p95 seconds | Combined simulated NEAR per correct result |
| --- | ---: | ---: | ---: | ---: | ---: |
| Persistent single agent | 63/80 | 1 | 16 | 14.97 | 0.4152 |
| Fixed specialists | 72/80 | 1 | 7 | 14.40 | 0.2976 |
| Backstop recovery market | 75/80 | 1 | 4 | 16.25 | 0.3007 |

Combined simulated cost sums customer debits after refunds and compensation plus consumed guarantor bonds, across all trials, then divides by correct deliveries. This avoids counting compensation twice. Inference bills are outside this ledger measure. Three trial records share one provider timeout with no token report, so the report leaves tokens per correct delivery blank. Latency is end-to-end inside the harness, with each scheduler charged the same first-call time. The run used six concurrent paired blocks.

Applying posted uncached input and output rates to reported usage gives an estimated inference cost per correct result of $0.00070 for Backstop, $0.00073 for fixed specialists, and $0.00069 for persistent retries. These estimates charge each scheduler for the shared first request and omit the attempt with missing usage. [NEAR AI rates](https://near.ai/models/deepseek-ai/DeepSeek-V4.1-Flash-1017) · [OpenAI rates](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

Against fixed specialists Backstop won three pairs and lost zero, a 3.75 percentage point difference with an exploratory task-cluster interval of 0 to 8.75 points. Under the provider outage the two specialist modes tied at 12/16 correct. Backstop accepted one wrong answer under that condition and fixed accepted none. The three false accepts across the full run missed an all-zero quota cap or a self-dependency case in the acceptance gate. The separate audit caught them. The small corpus and the tradeoff in latency and cost leave a consistent market advantage unproven. [Raw trials](held-out-results.json)

To repeat, configure the primary with `BACKSTOP_AI_*` and the second endpoint with `BACKSTOP_BENCH_SECOND_BASE_URL`, `BACKSTOP_BENCH_SECOND_MODEL`, and `BACKSTOP_BENCH_SECOND_API_KEY`. Run `pnpm benchmark:live --held-out --repeats 2 --concurrency 6 --seed 738291 --out /tmp/backstop-heldout-repeat.json`. Inference is live and outcomes may vary.

## Recovery retest and fresh tasks

The retest reused the eight earlier tasks and seed 738291. It added separate acceptance probes for all-zero caps, self-dependencies, and exact alert closing thresholds. Both specialist schedulers could use two prepriced standby slots on the second provider when market bids were unavailable. The slots were simulated and used live inference. Every scheduler got the same updated acceptance gate, public recovery examples, and three-call cap. The harness keeps the private audit inputs from the models. The funded ceiling was 0.65 NEAR, including bond liability.

| Run | Scheduler | Correct | False accepts | Correct under simulated outage | p95 seconds | Simulated NEAR per correct result, including bonds |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Regression | Backstop | 79/80 | 0 | 16/16 | 11.39 | 0.2975 |
| Regression | Fixed specialists | 78/80 | 0 | 15/16 | 12.05 | 0.2915 |
| Regression | Persistent retries | 64/80 | 0 | 0/16 | 13.17 | 0.4081 |
| Four fresh tasks | Backstop | 37/40 | 3 | 7/8 | 19.33 | 0.3518 |
| Four fresh tasks | Fixed specialists | 37/40 | 1 | 7/8 | 19.81 | 0.3392 |
| Four fresh tasks | Persistent retries | 32/40 | 0 | 0/8 | 17.97 | 0.4100 |

Backstop recovered all five of its earlier misses in the retest. Its remaining failure used all three calls on the alert task after injected tool loss. On the fresh tasks the two specialist schedulers each won two pairs and lost two. The Backstop audit caught two patches that mishandled object property names as IDs and one that applied an allowance incorrectly when sessions repeated. These results leave the overall reliability advantage unresolved. Both runs used eight concurrent blocks, the same two providers, and live generation that can vary between runs. [Regression results](recovery-retest.json) · [Fresh results](fresh-recovery.json)

The fresh retest adds acceptance probes for IDs that collide with JavaScript object properties and for duplicate sessions whose individual billable time is zero. On an offline replay of the 110 recorded deliveries, the revised gate rejected all four known incorrect deliveries across the three schedulers and preserved all 106 correct deliveries. A live retest would measure whether the additional recovery attempts produce correct replacements within the same budget.

```sh
pnpm benchmark:live --verify-run benchmarks/recovery-retest.json
pnpm benchmark:live --verify-run benchmarks/fresh-recovery.json
pnpm benchmark:live --recovery-retest --repeats 2 --concurrency 8 --seed 738291 --out /tmp/backstop-recovery-retest.json
pnpm benchmark:live --fresh --repeats 2 --concurrency 8 --seed 511723 --out /tmp/backstop-fresh-recovery.json
pnpm benchmark:live --fresh-retest --repeats 2 --concurrency 8 --seed 511723 --out /tmp/backstop-fresh-retest.json
```

## Live standby benchmark

On 14 November 2026, 48 pairs across six newly written tasks ran through the SQLite-backed coordinator over HTTP. Each pair shared its primary inference and initial checkpoint, had a 240-second wall limit and at most three inference calls per arm, and funded 0.40 NEAR escrow, 0.04 NEAR premium, and 0.25 NEAR bond. Each arm used the same workers, quote schedule, verifier tests, and fault. The fixed order was declared before the run. The auction chose among eligible bids by price. Audit cases and the oracle were withheld from workers. The task authors and operators were on the Backstop team.

| Scope | Scheduler | Correct | False accepts | p95 seconds | Settlement cost per correct result | Total bond consumed |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| All trials | Backstop | 48/48 | 0 | 18.112 | 0.380 NEAR | 1.44 NEAR |
| All trials | Fixed specialists | 48/48 | 0 | 17.041 | 0.475 NEAR | 3.12 NEAR |
| Primary provider outage | Backstop | 12/12 | 0 | 16.058 | 0.520 NEAR | 1.44 NEAR |
| Primary provider outage | Fixed specialists | 12/12 | 0 | 17.041 | 0.580 NEAR | 2.16 NEAR |

The four conditions were healthy execution, an actual SIGKILL after checkpoint, the same SIGKILL plus an injected outage that withheld both primary-provider specialists from bidding, and a known incorrect submission. NEAR AI Cloud and OpenAI served live inference. Two separately signed and registered team-run standby processes booked capacity before primary assignment, then signed readiness in each recovery window. The coordinator activated standby on all 24 outage trials. The fixture vault accounted for settlement, including consumed bonds. Cost covers escrow paid, earned premiums, and consumed bonds. The report also includes provider tokens per call. Real inference charges, gas, and any standby retainer are outside the reported cost. Latency covers primary inference plus elapsed time from first assignment through settlement.

The market tied fixed specialists on correct delivery. Settlement cost was 20% lower at the declared worker prices. The cheaper quote schedule explains the cost difference, and the overall p95 was 1.071 seconds slower. The benchmark does not estimate operator prices or prove higher delivery reliability in production. A separate [NEAR Sandbox rehearsal](../docs/outside-workers.md#standby-settlement-on-near-sandbox) used the normal outside-worker CLI and verified the winning standby payout through the chain.

```sh
pnpm benchmark:standby --verify benchmarks/live-standby.json
pnpm benchmark:standby --lanes 6 --repeats 2 --out /tmp/backstop-standby.json --state /tmp/backstop-standby-state
```

## Outside tasks and a quote-aware fixed order

Correction from the rejected-recovery review: the injected rejected-output checkpoint in this historical run included the reference implementation and one hidden acceptance input. That condition was not fully blind to recovery workers. The other conditions did not use this injected checkpoint. The numbers below are retained as historical results; the fresh evaluation described in [the revised protocol](REJECTED-RECOVERY.md) removes this leakage.

The external suite adapts ten JavaScript problems from [HumanEval-X](https://github.com/zai-org/CodeGeeX/tree/2838420b7b4492cf3d16bce5320e26e65960c9e2/codegeex/benchmark/humaneval-x/js) and draws its cases from [HumanEval+ v0.1.10](https://github.com/evalplus/humanevalplus_release/releases/tag/v0.1.10). The harness pins both downloads by SHA-256. Each task gets a deliberately broken starter, two public examples, 12 hidden acceptance cases, and 48 separate audit cases. The public datasets may have appeared in model training. The run withheld the acceptance suite, audit cases and reference implementation from the workers.

For the nested bracket problem, the JavaScript reference follows the stated subsequence rule. The EvalPlus Python reference differs on two of the selected inputs. A separate check verified that all 62 selected cases match the subsequence rule by testing whether a split leaves at least two opening brackets on its left and two closing brackets on its right. The other nine JavaScript references agreed with the EvalPlus Python references on every selected case.

Both arms get the same operator quotes and eligibility rules. Fixed specialists lock in ascending price within each tier before primary assignment. Ordinary workers quote 0.28 and 0.44 NEAR. Standby workers quote 0.52 and 0.58 NEAR. Backstop runs its normal auction. Under this quote schedule both policies prefer the same eligible worker. Each pair shares primary inference and inherits the same initial checkpoint. Recovery inference runs separately. This run uses the preceding benchmark's budget, providers, inference limits, four fault conditions, and fixture vault. All workers are team-controlled processes.

The adapter puts the original positional arguments inside one JSON array. For HumanEval/119, that means the two strings are inside the array's first element. Several generated patches treated the outer array as the pair of strings even after a rejected attempt. This is a failure of the tested repair flow on the adapter's input shape and does not establish difficulty on the unadapted upstream benchmark.

The run on 14 November 2026 completed 80 pairs. The original eight-lane run supplied 74 completed pairs. Six incomplete pairs ran at three lanes after stale leases and claims halted several lanes. Both arms of each recovered pair used the same concurrency and task policy. The latency figures reflect the combined run on shared hardware.

| Scope | Scheduler | Correct | False accepts | p95 seconds | Settlement cost per correct result | Total bond consumed |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| All trials | Backstop | 66/80 | 2 | 30.60 | 0.430 NEAR | 4.24 NEAR |
| All trials | Fixed specialists | 68/80 | 2 | 44.98 | 0.425 NEAR | 4.06 NEAR |
| Primary provider outage | Backstop | 18/20 | 1 | 28.67 | 0.564 NEAR | 2.55 NEAR |
| Primary provider outage | Fixed specialists | 19/20 | 1 | 21.21 | 0.554 NEAR | 2.52 NEAR |

Backstop alone succeeded in one pair, and fixed specialists alone succeeded in three. All 63 pairs that reached recovery in both arms selected the same first recovery worker. The 2.5 percentage point delivery deficit describes this run. With a static quote schedule that leads both policies to the same choices, independent recovery inference and run timing can change outcomes without a scheduling advantage. Settlement cost includes consumed bonds and excludes provider bills, gas, and standby retainers. [Raw results](external-standby.json)

```sh
pnpm benchmark:standby --external --verify benchmarks/external-standby.json
pnpm benchmark:standby --external --lanes 8 --repeats 2 --out /tmp/backstop-external.json --state /tmp/backstop-external-state
```

## Verifier feedback and recovery routing

This historical run reused the same rejected-output injection described above, including its reference-code and hidden-input leakage. Its rejected-output condition must not be described as fully blind.

The rerun uses the same ten external tasks, quotes, providers, fixture vault, 0.65 NEAR recovery cap, three inference calls, and four fault conditions. Both arms have the same patch and rebuild specialists. The quote-aware baseline still locks in the cheapest order within each tier. Backstop prefers the task's stated strategy and can switch to rebuild after verifier errors, repeated rejected artifacts, or failures confined to held-out cases. When the primary provider is disabled, only the standby specialists can take recovery. Signed bids retain the offered strategy and use the same price and eligibility checks.

The initial strategy labels were chosen before this rerun, with the previous results available. HumanEval/119, /129, /132 and /154 prefer rebuild. The others prefer patch. The workers received public examples, a summary of verifier failures for the rejected checkpoint, and their own strategy instructions. Fixed specialists received the same strategy instructions and the existing generic failure reason. This compares both changes together. The audit inputs stayed out of worker prompts. The same 750 ms heartbeat grace was added in both arms to reduce infrastructure interruptions.

| Scope | Scheduler | Correct | False accepts | p95 seconds | Settlement cost per correct result | Total bond consumed |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| All trials | Backstop | 62/80 | 0 | 31.06 | 0.479 NEAR | 5.88 NEAR |
| All trials | Fixed specialists | 64/80 | 0 | 51.55 | 0.431 NEAR | 4.76 NEAR |
| Primary provider outage | Backstop | 17/20 | 0 | 15.58 | 0.571 NEAR | 2.91 NEAR |
| Primary provider outage | Fixed specialists | 17/20 | 0 | 15.51 | 0.554 NEAR | 2.61 NEAR |

The 14 November 2026 run completed all 80 pairs. Backstop alone delivered a correct repair in two pairs, and fixed specialists alone did so in four. The initial recovery worker differed in 42 of the 66 pairs where both arms started recovery. Backstop correctly recovered 16/20 worker crashes, versus 14/20 for fixed specialists, and delivered 15/20 after an injected rejected patch, versus 18/20. The benchmark recorded lower p95 overall for Backstop, with slightly higher p95 during outage and higher settlement cost per correct result. Deployment expenses and inference charges are outside settlement cost. [Raw results](routed-standby.json)

HumanEval/132, /119, and /129 accounted for 17 of Backstop's 18 unsuccessful trials. Public verifier feedback did not reliably break repeated failures. For the paired result, the most frequent difference was failure to produce an accepted repair within the call limit. The task strategy labels express engineering judgment and the operator profiles are team-controlled. This run does not establish the best worker for each task or isolate the effect of feedback from the routing rule.

```sh
pnpm benchmark:standby --external --verify benchmarks/routed-standby.json
pnpm benchmark:standby --external --routed --lanes 5 --repeats 2 --out /tmp/backstop-routed.json --state /tmp/backstop-routed-state
```

## Rejected-patch repairs and fresh external evaluation

The 14 November 2026 evaluation fixes contradictory rebuild instructions, makes nested input shapes explicit, and feeds local retries their own rejected source. The fresh run gives both arms the same improved prompts and verifier summaries. It replaces the historical reference-containing rejected checkpoint with a public-example-only lookup. Task-ID routing hints were removed for this evaluation. The three known problem tasks were used for development; ten different external task IDs were reserved for the fresh run.

| Evaluation | Scheduler | Correct | False accepts | p95 seconds | Settlement NEAR per correct result |
| --- | --- | ---: | ---: | ---: | ---: |
| Three-task final regression | Backstop | 18/24 | 1 | 67.084 | 0.443889 |
| Three-task final regression | Fixed specialists | 17/24 | 1 | 51.946 | 0.462353 |
| Ten fresh tasks | Backstop | 78/80 | 0 | 20.008 | 0.424872 |
| Ten fresh tasks | Fixed specialists | 78/80 | 0 | 16.153 | 0.390000 |

There was no fresh-task delivery advantage: neither arm won a pair the other lost. Backstop cost 8.9% more per correct delivery and had 23.9% higher overall p95. Both failed the same two rejected-output cases by retaining spaces in parenthesis groups. The known-task regression recovered 5/6 rejected patches for Backstop versus 4/6 for fixed, but retained one false acceptance each. The Backstop false acceptance was a grid solver exceeding the audit execution budget. Both live providers and the prior three-call, token, price, and recovery-budget limits were retained; all operators were team-controlled and settlement was simulated. These results do not support a first-place claim.

[Full protocol, fixes, limitations and reproduction commands](REJECTED-RECOVERY.md) · [Fresh raw results](fresh-rejected-recovery.json) · [Final development regression](rejected-recovery-regression.json)


## Contract checks and price-first recovery

The next frozen evaluation added concrete public preflight counterexamples, declared resource and boundary checks, repeated-failure detection, and price-first bidding with strategy as a tie-breaker. Both arms received the same changes. On ten fresh external tasks, each delivered 78/80 correct results with zero false acceptances and 20/20 rejected-output recoveries. Backstop's p95 was 31.440 seconds versus 25.785 for fixed; simulated settlement cost per correct delivery was 0.382051 versus 0.378974 NEAR, including consumed bonds but excluding provider bills and gas. The four-task development regression was 25/32 versus 27/32, with no false acceptances.

Backstop still does not beat the quote-aware fixed baseline. Repeated bracket and threshold mistakes remain, and one recovery auction closed before bids arrived. A reporting exception on that terminal failure was recovered from its persisted event stream and counted as a failure; no trial was rerun. Read the [protocol, full results, reporting provenance and limitations](CONTRACT-RECOVERY.md), [fresh raw trials](contract-recovery-fresh.json), and [regression raw trials](contract-recovery-regression.json).


## Semantic recovery and bounded standby hold

The next evaluation retained the original one-second bid window and all funding/inference caps. An empty auction now waits up to leaseMs + heartbeatGraceMs for an eligible precommitted standby, while ordinary bids stay closed. Workers use precise public output mismatches, concise algorithm checks and specification-based subsequence/threshold guidance. Both arms receive the same changes.

Known bracket/threshold regression: 16/16 correct for each arm. Ten new external tasks: 80/80 each, zero false acceptances, and simulated settlement cost of 0.38 NEAR per correct delivery for both. Observed p95 was 33.470 seconds for Backstop versus 35.868 for fixed. All 80 pairs had identical worker assignments, so the timing difference does not establish a routing advantage. The monitor observed no Remotion or ffmpeg processes during 694 samples spanning both final runs. The delayed-readiness edge was exercised in tests; it did not occur naturally in these live runs. [Protocol, validation and limitations](SEMANTIC-RECOVERY.md) · [Fresh raw trials](semantic-recovery-fresh.json) · [Regression raw trials](semantic-recovery-regression.json) · [Render monitor](semantic-recovery-load.json).


## Provider diversification after a rejected recovery

The next fresh evaluation combined ten unused external problems into ten three-function repair modules. Both arms retained the same three-call, prompt/output, quote, funding and outage limits. After a verified rejected recovery, Backstop could give its final attempt to the cheapest eligible ready worker at a different configured provider; fixed kept its quote-sorted order.

Backstop **lost this run: 72/80 correct versus 77/80**, zero false acceptances in either arm, zero paired correctness wins and five losses. Simulated settlement cost per correct delivery was 0.405833 versus 0.396234 NEAR, including consumed bonds and excluding provider bills and gas. Observed p95 was 66.976 versus 70.090 seconds, but late render activity overlapped twelve successful trials, so this was not a fully idle-machine run and its small timing lead does not establish an advantage. All failed deliveries preceded the detected render activity.

The routing override fired six times: two correct deliveries, two prompt-limit refusals, one invalid/truncated response, and one verifier rejection. Fixed also succeeded in both successful-switch pairs, using its cheaper retry. All 160 trials were retained and independently replayed. This result does not support enabling diversification by default; bounded prompt construction and explicit failure causes are higher-priority follow-ups. [Full protocol, failure breakdown and limitations](PROVIDER-DIVERSIFICATION.md) · [Raw results](diversity-recovery-fresh.json) · [Replay/analysis](diversity-recovery-summary.json) · [Load monitor](diversity-recovery-load.json).


## Bounded prompts and timeout-aware routing

The next frozen run used ten previously untested components composed into five-function modules, with the same calls, tokens, source, timing, funding, quotes and fixed baseline. Both arms received budgeted code-only prompts and explicit fenced failure reports; Backstop could prefer another eligible provider after a reported timeout.

Backstop **did not win: 79/80 correct versus 80/80 fixed**, zero false acceptances, zero paired wins and one loss. Prompt overflow and invalid/truncated outputs were zero in both arms. Two timeout-triggered switches produced one correct delivery and one final-attempt scope error; fixed succeeded in both corresponding pairs. Simulated settlement cost per correct delivery was 0.386962 versus 0.380750 NEAR (Backstop 1.63% higher), including consumed bonds and excluding provider invoices/gas/retainers. Observed p95 was 60.095 versus 59.071 seconds. All 160 trials were retained and independently replayed, and 1397 monitoring samples showed no Remotion/ffmpeg processes.

The prompt-cap failure was addressed, and the timeout handoff worked, but routing still has no demonstrated advantage. The fresh corpus has higher aggregate structural complexity and more functions per module, with simpler constituent functions; empirical difficulty and causality relative to prior runs are unproven. Workers remain team-controlled. [Full protocol, exact failure and limitations](BOUNDED-RECOVERY.md) · [Raw results](bounded-recovery-fresh.json) · [Replay/analysis](bounded-recovery-summary.json) · [Load monitor](bounded-recovery-load.json).
