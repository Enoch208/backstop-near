# Repair your own JavaScript task

Backstop can recover a dependency-free JavaScript function with a pinned specification and test suite. Start with [the calendar interval example](../fixtures/repair/normalize-intervals.json) or make a copy and replace its objective, rules, initial source, reference implementation, and test cases.

```sh
export BACKSTOP_AI_API_KEY='your NEAR AI Cloud key'
pnpm demo --task fixtures/repair/normalize-intervals.json --output /tmp/merge-intervals.js --manual-kill
```

The primary makes a live model call and saves a checkpoint. Press Enter at the prompt to send it a real `SIGKILL`. Omit `--manual-kill` to inject the failure automatically. After the lease expires, the repairers price the remaining work and bid. The winner verifies the checkpoint hash before resuming. A coalition winner can use its diagnostician's finding. After the verifier accepts the patch, the challenger has a window to disprove it with one of the pinned probe inputs. The demo writes the accepted source to a new file after successful settlement and prints its content hash.

The default demo uses the fixture vault, which simulates money movement. Add `--chain sandbox` to use a local NEAR node after building the vault with `pnpm vault:build`. Add `--chain testnet` only with a funded testnet account and credentials as described in the [testnet setup](../README.md#on-a-real-near-node).

The task bundle contains:

- `objective` and `rules`, a short request and the behavior the function must implement.
- `source`, the contents of the broken JavaScript file. Define a synchronous function accepting one JSON value and returning a JSON value. Local helper functions are allowed.
- `suite.entry`, the JavaScript function name, and `suite.suiteId`, a label for this revision of the suite.
- `suite.oracleSource`, a reference implementation of the requested behavior. The API checks that it agrees with each declared test.
- `suite.cases`, each with a unique `id`, a `visibility` of `public` or `held_out`, and an `input` and `expected` JSON value. Supply at least one of each visibility. Workers only see the public cases.
- `challengeInputs`, optional inputs separate from the held-out cases. The coordinator publishes the reference outputs for these probes to support diagnosis and challenges.
- `primaryMilestone`, an optional first stage with its own `objective`, `rules`, and `publicCaseIds`. The primary must improve those cases, pass every selected case, and leave at least one pinned challenge probe failing before it records a partial checkpoint. The calendar example first fixes sorting and leaves the touching range rule for recovery.

The runner uses QuickJS compiled to WebAssembly. Each case runs in a fresh guest runtime without host filesystem, network, or process bindings, with bounds on evaluation time, memory, stack, and output. The task manifest commits to the bundle, suite, and runner before funding. Acceptance covers the pinned tests and submitted challenges. Use independent cases to exercise edge conditions and avoid placing any secrets in the source, rules, or public probes.
