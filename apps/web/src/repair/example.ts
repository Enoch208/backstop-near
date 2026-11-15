import { repairTaskSchema } from "@backstop/shared";
import intervals from "../../../../fixtures/repair/normalize-intervals.json" with { type: "json" };

export const exampleTask = repairTaskSchema.parse({
  objective: intervals.objective,
  rules: intervals.rules,
  source: intervals.source,
  suite: intervals.suite,
  challengeInputs: intervals.challengeInputs,
});

export const exampleJson = JSON.stringify(exampleTask, null, 2);
