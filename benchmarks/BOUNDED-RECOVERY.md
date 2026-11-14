# Bounded prompts and timeout-aware recovery

## Frozen question and protocol

Does prompt packing plus timeout-aware routing improve correct delivery against the unchanged quote-aware fixed-specialist baseline? Both arms receive the same budgeted, code-only prompt builder and authenticated failure reporting. Only Backstop may prefer an eligible ready worker on another configured provider after a reported request timeout; fixed retains ascending quoted price within ordinary/standby tiers. The earlier final-attempt diversification rule after a verified recovery rejection remains. A worker crash or expired lease alone never proves a provider timeout. Worker reports authenticate ownership and fencing, not the truth of a provider outage; provider identities are coordinator configuration, not external attestations.

Prompt packing retains the complete objective, rules, entry point and all public input/expected examples. It first removes optional guidance/diagnostics, then explicitly requests a rebuild without the old source if necessary. Irreducible instructions fail before a provider request. Code-only output replaces the prose demand in both arms. No cap or quote is increased and routing adds no model calls. Explicit prompt-limit and invalid-output failures release the attempt without being treated as provider failures. New failure risk loading equals the previous lease-expiry loading.

The previous run was Backstop 72/80 versus fixed 77/80. Its eight prompt refusals were reconstructed exactly and now fit without omitting source; this is development evidence, not a fresh outcome. Three hundred new-corpus prompt/style variants fit 8192 bytes before inference.

## Fresh harder workload selected before inference

Exclude all 50 component IDs used in prior benchmark corpora. Select previously untested HumanEval/EvalPlus components using seed 314159 and Python reference structural complexity at least 3. Validate safe exact integer domains and sufficient distinct cases before any model calls; exclude 55 (fewer than 64 inputs), 106 (insufficient distinct inputs within the exact-safe factorial domain), and 39 (fewer than 64 inputs). Selected IDs: 40, 57, 33, 142, 153, 107, 128, 96, 114, 131. Ten modules combine five components each using cyclic offsets 0, 1, 3, 6, 8; each component appears five times. There are 4 public, 12 private acceptance and 48 separate audit cases per module. All 640 component comparisons against independent Python references and 640 composed comparisons matched. Starter and public-only rejected mutants were validated before inference.

These are newly composed external-derived tasks, not unmodified external tasks or 80 independent unseen problems. Public originals may have been in model training. Structural workload increases to five functions rather than three, and aggregate structural complexity 17 versus 14.1 previously. Individual components are simpler on average (3.4 versus 4.7); empirical model difficulty is unknown. Components and repeated trials are correlated. Corpus hash: sha256:cd3fc8d3ffe6d9da43bb096834e5c41c983106d9f78904c3336faf273ce13150.

Ten modules × four faults × two repeats × two arms = 160 trials / 80 matched pairs, seed 560831, three lanes. Faults remain healthy, primary worker crash after checkpoint, primary-provider outage, and public-passing rejected output. Both arms share each primary inference and its elapsed-time charge, with independent recovery calls. Same roster, provider models, checkpoints, diagnostics, verifier, quotes, reservations, auctions and outage conditions. Fixed can choose its order using published quotes. Team-controlled workers use separate signing keys; they are not independent outside operators.

Caps remain 3 calls/assignments, 8192 prompt bytes, 960 output tokens, 4096 source bytes, 45-second request timeout, 240-second task deadline. Quotes remain 0.28/0.44 ordinary and 0.52/0.58 standby NEAR; escrow 0.40, premium 0.04, bond 0.25, recovery capacity 0.65. One-second auction, 1200 ms lease, 750 ms grace and at most 1950 ms standby hold. Settlement is simulated and excludes provider invoices, gas and standby retainers.

Primary endpoint is correct independent-audit delivery across all scheduled trials. Report paired wins/losses, false acceptance, all-trial p95, simulated settlement per correct result including bonds, usage, actual timeout-triggered awards and terminal failure causes. Do not stop early, tune after outcomes, drop failures, expand the sample to get a win, or treat a numerical edge on correlated tasks as general superiority. All source and task definitions remain frozen during evaluation. A fixed provider-alternating policy is not tested.

Monitor Remotion/ffmpeg activity during the complete live run. No builds/tests/renders are started by this chat during evaluation; other app/system load remains possible. Preserve any contamination in the report, including unsuccessful trials. Source fingerprint, raw trials, corpus validation, load monitor and independent replay accompany results.

## Result

The complete frozen run **does not beat fixed specialists: Backstop 79/80 versus fixed 80/80**. All 160 scheduled trials were retained, including the final completed trial, which was Backstop's only failed delivery. There were zero Backstop-only correct pairs and one fixed-only correct pair. No extra evaluation was selected after this outcome.

| Metric | Backstop | Quote-aware fixed |
| --- | ---: | ---: |
| Correct delivery | **79/80 (98.75%)** | **80/80 (100%)** |
| Healthy | 20/20 | 20/20 |
| Worker crash | 20/20 | 20/20 |
| Primary provider outage | 20/20 | 20/20 |
| Injected rejected output | 19/20 | 20/20 |
| False acceptances | 0 | 0 |
| Observed p95 seconds, all trials | 60.095 | 59.071 |
| Total simulated settlement, NEAR | 30.57 | 30.46 |
| Simulated settlement NEAR per correct delivery | 0.386962 | 0.380750 |
| Consumed bonds, NEAR | 2.73 | 2.46 |

Backstop cost **1.63% more per correct delivery** and had a slightly slower observed p95. Simulated settlement includes consumed bonds but excludes provider invoices, gas and standby retainers. One discordant pair and correlated modules do not establish general superiority of either system; they do rule out a claim that Backstop won this run. The changed task corpus also prevents attributing the improvement over the previous 72/80 run solely to these code changes.

## What worked, and what failed

There were **zero prompt-limit refusals and zero invalid/truncated outputs in either arm**. Each arm compacted optional guidance on 24 charged calls, retained the mandatory specification/public examples, and never needed the source-omitting compaction fallback. Maximum recorded prompt size was 8182 bytes. Maximum reported output was 764 tokens for Backstop and 652 for fixed, under the unchanged 960-token cap. All eight previous overflow prompts also fit in the development replay without dropping source; those are not fresh accuracy trials.

Two Backstop recovery calls timed out on NEAR AI Cloud. Both active workers submitted authenticated, correctly fenced PROVIDER_TIMEOUT reports, and the coordinator selected the eligible 0.52 OpenAI standby over the available 0.44 same-provider retry. One switch delivered correctly; one failed. Fixed completed both corresponding tasks using its 0.28 first recovery. Thus the successful switch validates the routing mechanism but adds no paired correct delivery. Recovery calls are independent; this is not a controlled same-timeout comparison, and it does not prove that staying on NEAR would have rescued the failed Backstop trial.

The failed trial is bounded-131-40-33-107-96 / rejected-output / repeat 1. After the injected public-passing primary patch was rejected, the first recovery request timed out at 45 seconds. The last allowed assignment switched providers and returned complete code in about 5.5 seconds. That code declared let resC inside an else block, shadowing the function-scoped var resC used in the final returned array. Nonempty component-C inputs therefore returned undefined. Three of four public cases, all 12 private acceptance cases and all 48 audit cases failed. The verifier rejected the result; the task exhausted its three assignments and settled as a failure. There was no prompt overflow, truncation, early auction close or missing standby in this failure.

A post-run diagnostic changed only the shadowing declaration in a temporary copy and checked the same 64 cases to verify the cause. It made no model call and did not alter the frozen output or score. The failed generated artifact remains a failure in the report.

A separate primary-provider-outage pair needed a third assignment in both arms after a semantic rejection. Both succeeded with the second OpenAI standby; no eligible alternative provider was available, so the fallback remained unchanged. Overall assignment sequences matched in 78/80 pairs; first recovery workers matched in all 80. Backstop used three third assignments versus one for fixed.

The remaining gap is recovery quality under the remaining budget. A timeout-triggered provider switch does not ensure that the alternative produces valid code, and this sample supplies no measured advantage for paying that premium. Keep the diversification configuration opt-in. A next routing policy should use held-out, task-relevant correctness and latency evidence for the remaining eligible workers, and compare isolated request timeouts with corroborated provider outages. A public-case check would expose the generated scope error, but correcting it still needs a declared repair mechanism within the same call budget; an uncounted retry would invalidate the comparison.

## Usage, load and validation

| Recorded usage, shared primary charged to each arm | Backstop | Fixed |
| --- | ---: | ---: |
| Inference attempts charged | 143 | 141 |
| Reported prompt tokens | 270423 | 270455 |
| Reported output tokens | 74507 | 74220 |
| Timed-out calls with usage unavailable | 4 | 2 |

Two primary timeouts were shared across arms inside forced-crash/provider-outage scenarios and retained those controlled fault paths. Backstop had two additional recovery timeouts that exercised the new reports. Timeout provider usage is unavailable, so the token totals are incomplete and are not provider-invoice estimates.

The load monitor recorded **1397 samples with zero Remotion/ffmpeg processes**, covering the entire live evaluation. No tests, builds or renders were started by this chat during the run; ordinary OS/application and remote-provider load remain uncontrolled. All 36 fingerprinted implementation files still matched the frozen hash afterward.

Independent replay verified all 80 pairs, 159 correct deliveries, 44 standby activations, 43 verifier-feedback records, two timeout-triggered awards and two fenced worker-failure reports, signed quotes, checkpoint provenance, eligibility, budgets and settlement conservation. The previous diversification report still independently replays at its original 72/80 versus 77/80. Full typecheck and all **238 tests across 46 files** passed before the run; scoped standard/local lint and formatting passed. The repository-wide lint remains blocked by nine pre-existing errors outside this change. No commit was made.

## Evidence and reproduction

[Raw trials](bounded-recovery-fresh.json) · [Replay and analysis](bounded-recovery-summary.json) · [Load monitor](bounded-recovery-load.json) · [Corpus validation](bounded-corpus-validation.json) · [Independent component validation](bounded-component-validation.json) · [Prompt/style validation](bounded-prompt-validation.json) · [Historical overflow regression](bounded-overflow-regression.json) · [Failed-source diagnosis](bounded-failure-audit.json)

Raw JSON SHA-256: 289b29326b014b23b7e4de7fefab96cd3f431d1e7bb4ff8f0fa8af04dd17d0bd.

```sh
pnpm benchmark:standby --external --routed --hardened --contract-checks --diversify --bounded --fresh-bounded --verify benchmarks/bounded-recovery-fresh.json
```

A new live run requires fresh output/state paths and the two provider configurations; the command used three lanes and two repeats. Repeating these tasks is a regression, not another fresh sample. Outside operators, provider-fault attestation and real USDC settlement were not tested.

Frozen implementation: sha256:34b3655e8ddc9b9bacec9c2f7975dfe8acfca404329ae45218a9276c0a9b6faf. Run started 2026-11-14T23:06:19.332Z.
