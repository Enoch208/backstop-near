# Provider diversification on the final recovery attempt

## Frozen question and decision rule

Does switching provider after a verified rejected recovery improve correct delivery against the same quote-aware, price-sorted fixed-specialist baseline? The previous fresh run tied at 80/80 with identical worker sequences in all 80 pairs. Pooled historical failures motivate diversification but do not estimate its causal benefit: prompts and tasks changed, and earlier trials never tested this cross-provider final attempt.

For a task with recovery routing enabled, after the verifier rejects a recovery attempt and exactly one attempt remains, Backstop prefers the cheapest eligible ready offer from a different known provider domain. Ready standby can compete with ordinary offers for this decision. A primary rejection alone does not trigger escalation; a rejected recovery following a primary crash does. A latest lease failure, unknown domain, or ambiguous coalition ownership does not establish a model failure. If no eligible independent offer is ready, the existing ordinary-then-standby rule remains. Existing exclusions, expiry, available funding and standby readiness apply. Fixed recoveryOrder bypasses the override.

The ordinary quotes remain 0.28 and 0.44 NEAR; independent standby quotes are 0.52 and 0.58. Switching from the 0.44 retry to the 0.52 standby costs 0.08 extra on a successful settlement. A higher success rate must justify that premium in the measured result, rather than being assumed. Inference prompts, diagnostics and model token caps are unchanged.

Provider identity comes from coordinator configuration, not a worker-declared label. The optional API environment variable BACKSTOP_AGENT_FAILURE_DOMAINS is a JSON map from registered agent ID to provider domain, supplied again on restart. A deployment must maintain the same configuration; it is not independently attested provider identity. Benchmark domains are derived from the actual configured provider endpoints and replay checks each executed attempt against them. The tested providers are NEAR AI Cloud and OpenAI, with models recorded in the raw report. This implementation diversifies provider domains; it does not distinguish different models hosted on the same provider.

## Predeclared fresh workload

Selection precedes any inference on these tasks. Exclude all 40 previously benchmarked HumanEval IDs. Count Python reference entry-function If, IfExp, For, While and comprehension nodes, including local nested helpers; retain counts at least four. Python Random(271183) orders the 18 eligible IDs. The first ten are 130,56,125,6,31,95,76,111,124,17, with no task exclusions. Mean structural complexity is 4.7 versus 2.4 in the previous fresh sample. This is a structural proxy, not an empirical difficulty measurement.

To avoid another ceiling test of small isolated functions, each of ten tasks repairs a three-function module under the unchanged per-call caps. Module i combines components i, (i+3) mod 10, and (i+7) mod 10. Each component appears three times. solve([argsA,argsB,argsC]) must return the corresponding three outputs; all components must be correct. These are newly composed tasks derived from external HumanEval/EvalPlus problems, not unmodified external benchmark tasks. Components overlap across modules, so outcomes are correlated and must not be represented as 80 independent unseen problems.

Pinned source downloads and digests remain those in the external task loader. Each component has 12 private acceptance and 48 separate audit inputs, plus public boundary examples. Independent Python canonical outputs matched all 639 selected component cases before inference. Six JavaScript reference adaptations correct translation or resource problems; selection/validation details are retained in the corpus validation artifact. Composite acceptance and audit cases zip their components; public cases contain only public component examples. Injected rejected outputs contain public-example lookups only, never oracle code or private cases. Public tasks may be in model training; fresh means new to this evaluation.

## Matched protocol and endpoints

Ten modules, four fault conditions, two repeats, two arms: 160 trials / 80 matched pairs. Seed 560831 randomizes block and arm order; three lanes. Faults are healthy, primary worker killed after checkpoint, primary provider unavailable to ordinary recovery workers, and an injected public-passing rejected patch. Same roster, quotes, tools, public diagnostics, verification, reservations and failure conditions for both arms. Each pair shares one primary inference; recovery calls are independent. Cached primary inference time is also waited out before execution in the second arm, so caching does not grant extra remaining task time.

Caps: three model calls per task, 8192 prompt bytes, 960 output tokens and 4096 source bytes per call, 45-second request timeout, 240-second task deadline. Funding: 0.40 escrow + 0.04 premium + 0.25 bond, 0.65 recovery capacity. Timing: one-second bid window, 1200 ms lease, 750 ms grace, bounded standby hold of at most 1950 ms. No extra inference calls for the routing decision.

Primary endpoint: correct delivery on the independent audit suite, with all scheduled failures retained. Report paired wins/losses, false acceptances, p95 latency across all trials, settlement cost per correct delivery including consumed bonds, and inference usage. Report final-attempt frequency, actual cross-provider overrides, and final-attempt successes separately. Rates conditioned on independently failing first recoveries are descriptive, not a paired causal comparison. If too few last attempts occur, this test cannot establish the hypothesized recovery benefit. The intended fixed sample will not be expanded, stopped early or tuned based on observed model outcomes. Thirty to forty second-recovery observations per arm would be useful for the suggested effect size, but cannot be guaranteed in advance.

All operators are team-controlled child processes with separate signing keys. Settlement is simulated; reported settlement costs exclude provider invoices, gas and standby retainers. This is a comparison against price-sorted fixed specialists. A fixed policy that alternates providers could reproduce this routing choice; no superiority over that untested baseline is claimed.

No video renders, builds or test runs will run during the frozen live evaluation. Remotion/ffmpeg executable activity is monitored without private command arguments; other OS/application load remains possible. All outcomes are retained. Raw report, source hash, corpus hash, monitor and independent replay results will accompany the result.

Frozen implementation hash: `sha256:f008101e71ea801502addca928ff8c1993d2fcf5a27f2e45cb666b9e6c0ee740`. Frozen composite corpus hash: `sha256:037641648a467f13222d36d322e5bd0de48a359d8f3e8310dbfdbae53f67ee4a`. Live evaluation began at 2026-11-14T22:23:30.116Z. The protocol and task selection were fixed before this run; no live pilot was used.

## Result: no delivery advantage

All 160 scheduled trials completed in a single run, with no reruns, dropped outcomes or reporting reconstruction. Independent replay verified 80 pairs, all 149 accepted deliveries, 56 standby activations, 68 verifier-feedback records, signed awards, budget caps, routing eligibility and settlement conservation. The first recovery worker matched in all 80 pairs; full assignment sequences matched in 70. There were **zero Backstop-only correct pairs and five fixed-only correct pairs**. The final source hash still matched the frozen implementation.

| Metric | Backstop | Quote-aware fixed |
| --- | ---: | ---: |
| Correct delivery | **72/80 (90%)** | **77/80 (96.25%)** |
| Healthy | 19/20 | 20/20 |
| Worker crash | 18/20 | 19/20 |
| Primary provider outage | 18/20 | 18/20 |
| Injected rejected output | 17/20 | 20/20 |
| False acceptances | 0 | 0 |
| Observed p95 seconds, all trials | 66.976 | 70.090 |
| Total simulated settlement, NEAR | 29.22 | 30.51 |
| Simulated settlement NEAR per correct delivery | 0.405833 | 0.396234 |
| Consumed bonds, NEAR | 3.90 | 3.19 |

Backstop delivered five fewer correct results and cost about 2.4% more per correct delivery. Its smaller total settlement cost accompanies fewer deliveries and is not an efficiency win. The small observed p95 difference does not establish a latency advantage: late render activity occurred, and failed deliveries are included in timing. Provider invoices, gas and standby retainers remain outside these simulated settlement figures.

[Raw trials](diversity-recovery-fresh.json) · [Replay and detailed analysis](diversity-recovery-summary.json) · [Component validation](diversity-component-validation.json) · [Module validation](diversity-module-validation.json)

## What the routing change actually did

Both arms reached a third assignment 16 times. Backstop delivered correctly on 8/16 third assignments; fixed delivered on 13/16. Only seven Backstop third assignments followed a verified rejected recovery, versus ten fixed assignments. Their conditional success rates were 3/7 and 9/10, respectively. These are different subsets of independently generated recoveries and must not be read as a controlled estimate of the models' relative quality.

The policy found a different ready provider six times; all six awards were checked against the configured provider domains and eligible signed quotes. One additional qualifying rejection had no independent eligible offer, so routing fell back. The six actual switches produced:

| Final cross-provider outcome | Count |
| --- | ---: |
| Correct delivery | 2 |
| Prompt over 8192 bytes; no provider request made | 2 |
| Invalid/truncated code at the 960-token output limit | 1 |
| Executed source rejected by the verifier | 1 |

The oversized prompts were 8301 and 8943 bytes. Both successful switches were on module-17-125-76 healthy trials; fixed also succeeded in those pairs using its 0.44 retry, while Backstop used the 0.52 standby. Thus neither successful switch produced an extra correct delivery, and each paid the 0.08 settlement premium. The shared semantic failure on module-6-76-130 remained a failure in both arms.

Across all eight Backstop failed deliveries, the final blocking outcome was a provider timeout once, an oversized prompt twice, invalid/truncated code four times, and a verifier rejection once. Five of the eight failures involved module-6-76-130, two module-17-125-76, and one module-95-124-125. Fixed failed three module-6-76-130 trials. Three of the five fixed-only successes coincided with a failed Backstop switch; the other two ended in same-provider timeout or truncation. Recovery responses are independent between arms, so these observations do not prove that routing alone caused every mismatch.

This sample falsifies a claim that this implementation wins on this workload. It does not prove provider diversity is generally worse. Six actual switches are far below the 30–40 last-recovery observations contemplated in the motivating note, and the modules share components. It also does not compare against a fixed provider-alternating policy.

The next implementation priority is **budget-aware prompt construction before consuming an assignment**: retain the exact specification and public tests, compact diagnostics and optional guidance, and use a complete rebuild prompt when carrying the failed source would exceed the cap. The current cheap patch worker can become unusable solely because its prompt grew, while the fixed rebuild worker omits that source. Next, distinguish provider timeout, prompt refusal, code truncation and verifier rejection in recovery evidence; currently several become LEASE_EXPIRED, so the semantic-rejection rule cannot respond to them. Finally, provider selection should account for measured ability to produce a complete correct repair within the cap, rather than treating a different provider as sufficient evidence of improvement. These follow-up changes were not made during this frozen run. The tested rule remains opt-in through coordinator configuration and should not be enabled by default on this evidence.

## Resource usage and machine load

| Recorded usage, shared primary charged to each arm | Backstop | Fixed |
| --- | ---: | ---: |
| Inference attempt records | 161 | 161 |
| Prompts refused before a provider request | 5 | 3 |
| Provider requests started, including timeouts | 156 | 158 |
| Provider-timeout records | 7 | 4 |
| Invalid/truncated-code records | 8 | 4 |
| Reported prompt tokens | 252100 | 260135 |
| Reported output tokens | 84569 | 85656 |
| Maximum charged elapsed seconds | 138.713 | 88.645 |

The four fixed timeout records are shared primary timeouts, also charged to Backstop; Backstop had three additional recovery timeouts. Timeout token usage is unavailable. Pre-call prompt refusals also have no token usage, but did not make provider requests. No recorded task approached the 240-second limit. Model-call opportunities and token limits remained equal; the two arms did not have equal realized provider bills, which were not reconciled.

The machine was render-free at launch, but the intended no-render condition did **not** hold throughout. The [monitor](diversity-recovery-load.json) recorded 1600 samples from 22:23:25 to 22:51:53 UTC. Remotion/ffmpeg appeared in 31 samples, first at 22:49:52 and last at 22:51:50. Executable sampling found overlap with 12 trial windows: five Backstop and seven fixed, all successful. All failed deliveries finished by 22:45:39, before the first detected render. The full run is retained; no post-hoc subset replaces it. This activity limits latency interpretation and means this must not be described as a completely idle-machine benchmark. No benchmark code, prompts or corpus changed during execution.

## Validation and reproduction

All 211 tests across 43 files passed, including 23 new routing/persistence tests. Full workspace TypeScript passed; changed source files passed ESLint and formatting. The full repository gate still stops on nine pre-existing lint errors in an archived run artifact and unrelated benchmark/token/replay scripts. No commit was made. The previous 80/80 semantic report still replays with its original corpus; its frozen result is unchanged.

```sh
pnpm benchmark:standby --external --routed --hardened --contract-checks --fresh-diversity --composite-diversity --diversify --verify benchmarks/diversity-recovery-fresh.json
pnpm benchmark:standby --external --routed --hardened --contract-checks --fresh-diversity --composite-diversity --diversify --lanes 3 --repeats 2 --out /tmp/backstop-diversity-repeat.json --state /tmp/backstop-diversity-repeat
```

A repeat uses the same now-exposed corpus; it is a reproducibility run, not fresh evaluation evidence. The final live result above is the single predeclared fresh run.
