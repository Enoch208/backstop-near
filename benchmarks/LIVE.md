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

```sh
pnpm benchmark:live --verify-run benchmarks/recovery-retest.json
pnpm benchmark:live --verify-run benchmarks/fresh-recovery.json
pnpm benchmark:live --recovery-retest --repeats 2 --concurrency 8 --seed 738291 --out /tmp/backstop-recovery-retest.json
pnpm benchmark:live --fresh --repeats 2 --concurrency 8 --seed 511723 --out /tmp/backstop-fresh-recovery.json
```
