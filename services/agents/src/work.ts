import { candidate, type Candidate, type CandidateName } from "@backstop/fixture-checkout";

export type WorkPlan = {
  readonly agentId: string;
  readonly produces: CandidateName;
  readonly validatedSubtasks: readonly string[];
  readonly completes: boolean;
};

export const fixtureWork: Readonly<Record<string, WorkPlan>> = {
  alpha: {
    agentId: "alpha",
    produces: "alpha-partial",
    validatedSubtasks: ["discount-before-tax"],
    completes: false,
  },
  beta: {
    agentId: "beta",
    produces: "beta-boundary",
    validatedSubtasks: ["discount-before-tax", "integer-cents", "half-up-rounding"],
    completes: true,
  },
  gamma: {
    agentId: "gamma",
    produces: "gamma-integer",
    validatedSubtasks: [
      "discount-before-tax",
      "integer-cents",
      "half-up-rounding",
      "free-shipping-boundary",
    ],
    completes: true,
  },
};

export function workFor(agentId: string): { plan: WorkPlan; artifact: Candidate } {
  const plan = fixtureWork[agentId];
  if (plan === undefined) throw new RangeError(`No fixture work for ${agentId}`);
  return { plan, artifact: candidate(plan.produces) };
}
