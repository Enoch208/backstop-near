import { formatNear, fromYocto } from "@backstop/shared";
import { statement } from "@backstop/ledger";
import { episodeStartMs, runEpisode, scenarios, type Scenario } from "@backstop/orchestrator";

const requested = process.argv[2] ?? "recovery";
const failFirstTransfer = process.argv.includes("--fail-transfer");

function isScenario(value: string): value is Scenario {
  return (scenarios as readonly string[]).includes(value);
}

if (!isScenario(requested)) {
  process.stderr.write(`Unknown scenario "${requested}". Choose one of: ${scenarios.join(", ")}\n`);
  process.exit(2);
}

const clock = (atMs: number) => {
  const seconds = Math.round((atMs - episodeStartMs) / 1_000);
  return `+${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

const episode = runEpisode(requested, { failFirstTransfer, challengeSeed: 7 });
const out = (line: string) => process.stdout.write(`${line}\n`);

out(`Backstop episode: ${episode.scenario}`);
out("Mode: FIXTURE. Simulated vault and clock, scripted agents. The verifier sandbox, signatures,");
out("challenge search, state machine and ledger are the real implementations. No NEAR is moved.");
out("");
for (const step of episode.steps) {
  const outcome =
    step.refused === null
      ? step.events.map((event) => event.body.type).join(", ") || "(no state change)"
      : `REFUSED ${step.refused.code}`;
  out(`${clock(step.atMs)}  ${step.actor.padEnd(26)} ${step.note}`);
  out(`${" ".repeat(8)}${outcome}`);
}

const view = statement(episode.record.ledger);
out("");
out(`Final state: ${episode.record.state} at version ${String(episode.record.version)}`);
out(
  `Total in: ${formatNear(view.totalIn)} NEAR. Confirmed out: ${formatNear(view.byStatus.CONFIRMED)} NEAR.`,
);
for (const [recipient, amount] of Object.entries(view.confirmedByRecipient)) {
  out(`  ${recipient.padEnd(28)} ${formatNear(amount)} NEAR`);
}
const budget = fromYocto(episode.record.manifest.budget.escrowYocto);
out(
  `Bond consumed: ${formatNear(episode.record.ledger.bondConsumed)} NEAR (escrow was ${formatNear(budget)} NEAR)`,
);
