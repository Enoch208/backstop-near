# Submission reproduction results

Team-run verification completed on 15 November 2026 WAT. This is **not an independent outside reproduction**; no outside tester was available. The [reviewer guide](independent-reproduction.md) is ready for someone outside the team to run.

## Source and setup

Executable source checked: `59655474a4baad481e301aa0486d5e7c469eb3b3` (`feat(web): show recovery and refund evidence clearly`). A fresh detached checkout was cloned from the committed local repository with no hard links. No `.env` or existing `node_modules` was copied; provider-related environment variables were removed from the check processes. Node 24.14.1 and pnpm 10.33.0 were used. The package-manager cache was available, so this is not a cold-registry download measurement.

The clean checkout remained unmodified after the checks. This report and the README corrections to test counts, installation networking and the overview URL are documentation-only follow-ups to that executable revision. The public repository must contain the tested commit and artifacts before an outside reviewer can reproduce them.

## Observed checks

| Command                          | Exit | Observed result                                                                                                                      |
| -------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` |    0 | Locked dependencies installed without copying workspace dependencies.                                                                |
| `pnpm gate`                      |    0 | Typecheck, ordinary lint and formatting passed; 47 test files and 249 tests passed.                                                  |
| `pnpm judge`                     |    0 | 11 of 11 claims hold. Includes fixture protocol, accounting and recorded attestation checks.                                         |
| `pnpm episode exhausted`         |    0 | FAILURE_SETTLED; simulated 0.69 NEAR in and out, customer 0.54 and guarantor 0.15. Customer total includes 0.10 capped compensation. |
| `pnpm judge --network`           |    0 | 16 of 16 claims hold in 111134 ms; public testnet reads only.                                                                        |
| Bounded benchmark replay below   |    0 | All 160 recorded trials / 80 pairs verified: Backstop 79/80, fixed 80/80; no false acceptances.                                      |
| `git status --porcelain`         |    0 | Empty output after the clean-checkout checks.                                                                                        |

```sh
pnpm benchmark:standby --external --routed --hardened --contract-checks --diversify --bounded --fresh-bounded --verify benchmarks/bounded-recovery-fresh.json
```

The working checkout also passed the local no-comments lint. The web production build passed with a bundle-size warning. Browser checks of the local preview confirmed that the recovery and failure links resolve, show the explicit mode labels, and read the matching ledger amounts from testnet. The live demo was not redeployed by these checks, and the browser walkthrough did not launch a new swarm or send a transaction.

## Failure found during preparation

The first working-checkout network check failed on HTTP 429 from public RPC. That failure was retained; it was not counted as a pass. Read-only proof calls now retry recognized transient errors with six total attempts, bounded exponential delays totaling at most 31 seconds, and endpoint rotation. Permanent or malformed errors still fail. Transaction submissions are not retried. Eleven focused tests cover these cases. A subsequent working-checkout run passed 16/16, followed by the separate clean-checkout pass above.

This does not guarantee public RPC availability. An unavailable endpoint must remain a failed or blocked reproduction, never a fabricated passing proof.

## Scope of the outcome evidence

- Recorded successful recovery: `two-bidders-testnet-1794682474`, real testnet 0.69 NEAR in and out; worker 0.0625, customer 0.3775, guarantor 0.25.
- Recorded expired-task refund: `recovery-red-team-mwgrr0y8`, real testnet 0.05 NEAR returned to the customer and repeated refund refused. Bond and compensation were zero.
- Rejected repair with bounded compensation: the separately labelled `pnpm episode exhausted` fixture. Its vault and funds are simulated.

The seven tracked testnet deployment/replay files were preserved byte-for-byte. The frozen benchmark and its 79/80 versus 80/80 result remain unchanged. This validation improves reproducibility and disclosure; it does not establish a routing advantage, independent operators, real customer adoption or a hackathon rank.
