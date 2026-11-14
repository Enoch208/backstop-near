# Fresh rejected-patch recovery evaluation

The fresh run is a single evaluation after development on HumanEval/119, /129 and /132. Its primary metric is correct delivery on the audit cases. Secondary metrics are false accepts, correct delivery by fault, p95 elapsed time, settlement cost per correct delivery, and consumed bonds. Every trial, including a failed delivery, remains in the report. There is no stopping rule based on which arm is ahead.

Both arms have the same worker implementation, public examples, verifier summaries, signed quotes, providers, budgets, and fault schedule. Fixed specialists lock the ascending quote order within ordinary and standby tiers before assignment. Backstop starts every task with patch preference and uses its existing feedback-based routing rule. There are no task-ID strategy labels in this run. A worker may independently rebuild after a matching verifier rejection; fixed specialist order remains fixed.

The run has ten tasks, four conditions, two repetitions and two arms: 160 trials in 80 pairs. It uses the prior seed 560831, shared primary inference within each pair, randomized arm/block ordering, a three-call cap, 8192 prompt bytes per call, 960 output tokens per call, 4096 source bytes, 45 seconds per call, and 240 seconds per task. Escrow is 0.40 NEAR, premium 0.04, bond 0.25 and recovery capacity 0.65. Ordinary quotes are 0.28 and 0.44; standby quotes are 0.52 and 0.58. Both arms have 1200 ms leases and 750 ms heartbeat grace. Settlement uses the fixture vault; provider calls are live. Settlement cost includes consumed bonds and excludes inference bills, gas and standby retainers.

The tasks are HumanEval/25, /100, /11, /61, /1, /46, /3, /146, /62 and /108, adapted from the pinned HumanEval-X JavaScript and EvalPlus v0.1.10 inputs. None appeared in the earlier Backstop benchmark corpus. A Python Random(271828) sample of the 154 remaining IDs first selected 39,25,100,11,32,61,1,46,3,146. /39 was excluded for insufficient distinct inputs, /32 for multiple valid floating roots incompatible with exact-output checking. Replacement draws were 62,83,108,52; /83 was excluded for insufficient distinct safe-integer outputs. /46 restricts n to at most 53 for exact JavaScript integer arithmetic. Selection occurred before any new-task inference. All 612 selected outputs agree with the upstream Python references. This checks references, not model performance. /46 has 40 audit cases; the others have 48. Each has two public and twelve hidden acceptance cases.

The rejected-output fault is a lookup of the two public examples with null for other inputs. It contains neither reference implementation nor hidden input. Unlike the old injected fault, it cannot expose the hidden test or supply the reference answer. Acceptance and audit cases are disjoint and withheld from workers. The public datasets may be in model training, so fresh means new to this evaluation, not demonstrably unseen in training. The operators are team-controlled processes with distinct signing keys. These results cannot establish independent operator availability or hackathon rank.

## Recovery changes and development results

Rebuild workers now receive the specification without the rejected implementation. The prompt no longer tells them to preserve that implementation. Public inputs include their nested argument structure and an exact one-argument invocation. The recovery prompt asks for a counterexample trace and a witness satisfying all constraints together. A worker switches to rebuild on matching hidden-only failures, execution errors, or an identical rejected artifact. The normal worker's bounded local retry receives its own failed code and public test inputs; it refuses to submit code that still fails public checks. The benchmark instead gives each assigned worker one inference call and lets the coordinator verify and reassign, preserving the three-call total.

The first development run completed 24 pairs on the three known tasks: Backstop 13/24 correct with one false acceptance, fixed 14/24 with two. After adding explicit input layouts and the counterexample/witness instruction, the final development regression completed another 24 pairs with the same budget and quote-aware order. Both development runs remain available: [first run](rejected-recovery-development.json), [final regression](rejected-recovery-regression.json). These are development results, not fresh-task evidence.

| Final regression | Backstop | Fixed specialists |
| --- | ---: | ---: |
| Correct delivery, all conditions | 18/24 | 17/24 |
| Correct after rejected patch | 5/6 | 4/6 |
| False acceptances | 1 | 1 |
| p95 seconds, all conditions | 67.084 | 51.946 |
| Settlement NEAR per correct delivery | 0.443889 | 0.462353 |
| Bond consumed, NEAR | 1.35 | 1.50 |

Backstop alone succeeded in four pairs; fixed alone succeeded in three. That is a one-delivery observed lead, not reliable superiority. Both solved HumanEval/119 in 8/8 trials. Backstop solved /129 in 5/8 and /132 in 5/8, versus 6/8 and 3/8 for fixed. Backstop's false acceptance on /129 was an exhaustive grid-path solver that passed the acceptance suite but exhausted the audit execution budget. Fixed's false acceptance on /132 returned the wrong boolean on one audit case. Remaining Backstop misses included resource errors on grid paths and repeated bracket-logic errors, including both provider-outage repetitions.

The final regression and fresh run record implementation hash `sha256:227a8a47d6f69c194998dbc7d4c03414db7f33e9cca2dab2a085cfdcf929ea3a`. No worker, prompt, routing, task or limit was tuned during the fresh run. Regression used three lanes; fresh evaluation used four. Latencies reflect shared hardware and live provider timing. The two task sets have different difficulty; their success percentages are not a controlled before/after estimate.

```sh
pnpm benchmark:standby --external --routed --hardened --regression --verify benchmarks/rejected-recovery-regression.json
pnpm benchmark:standby --external --routed --hardened --fresh-external --verify benchmarks/fresh-rejected-recovery.json
pnpm benchmark:standby --external --routed --hardened --fresh-external --lanes 4 --repeats 2 --out /tmp/backstop-fresh-repeat.json --state /tmp/backstop-fresh-repeat
```

## Fresh evaluation result

The single fresh run completed 160 trials in 80 matched pairs on 14 November 2026. Replay verified all 156 delivered artifacts, 44 standby activations, 52 verifier-feedback records, signed assignments, identical paired initial checkpoints, call and output caps, quote prices, bond limits, and transfer conservation. Backstop alone succeeded in zero pairs; fixed alone succeeded in zero. The first recovery worker differed in 20 pairs where both arms recovered. [Raw fresh results](fresh-rejected-recovery.json).

| Fresh tasks, all conditions | Backstop | Fixed specialists |
| --- | ---: | ---: |
| Correct delivery | 78/80 | 78/80 |
| Correct after rejected patch | 18/20 | 18/20 |
| Correct under primary-provider outage | 20/20 | 20/20 |
| False acceptances | 0 | 0 |
| p95 seconds | 20.008 | 16.153 |
| Total settlement cost, NEAR | 33.14 | 30.42 |
| Settlement NEAR per correct delivery | 0.424872 | 0.390000 |
| Consumed bonds, NEAR | 3.54 | 2.86 |

Backstop did not beat the fixed baseline on this run. Correct delivery tied, overall p95 was 23.9% higher, and settlement cost per correct delivery was 8.9% higher. Both arms failed the same two HumanEval/1 rejected-output trials: the generated implementations ignored spaces while tracking parentheses but kept those spaces in the returned substrings. Both repeated rejected implementations despite verifier summaries. No tuning or rerun of the fresh corpus followed these results.

The more expensive rebuild preference changed assignments without improving fresh-task delivery. On the rejected-output condition Backstop spent 0.456667 settlement NEAR per correct delivery versus 0.296667 for fixed. This run supports the input-shape and feedback engineering work as useful implementation changes; it does not establish a reliability or economic advantage for the routing policy. It also leaves the grid-path resource-limit false acceptance from development unresolved. The task sample, repeated conditions, simulated settlement, and team-controlled operators do not establish production reliability or a hackathon ranking.

Validation: 172 automated tests passed, full TypeScript checking passed, and lint/format checks passed on changed source files. The repository-wide gate remains blocked by existing lint errors in replay/demo files and formatting in an unrelated untracked document; that document and recorded replay source were left unchanged.

Inference usage charges the shared primary request to both arms, as the paired protocol requires. Provider bills were not reconciled. Recorded usage:

| Scheduler | Calls charged | Prompt tokens | Output tokens | Calls missing usage |
| --- | ---: | ---: | ---: | ---: |
| Backstop | 144 | 75558 | 14584 | 0 |
| Fixed specialists | 145 | 75019 | 14606 | 1 |
