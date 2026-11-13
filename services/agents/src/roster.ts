import { signingKeyFromSeed, type AgentRole, type SigningKey } from "@backstop/shared";

export type FixtureAgent = {
  readonly agentId: string;
  readonly account: string;
  readonly role: AgentRole;
  readonly key: SigningKey;
};

const agent = (agentId: string, role: AgentRole): FixtureAgent => ({
  agentId,
  account: `${agentId}.fixture.testnet`,
  role,
  key: signingKeyFromSeed(`backstop-fixture-key:${agentId}`),
});

export const roster = {
  alpha: agent("alpha", "executor"),
  beta: agent("beta", "repairer"),
  gamma: agent("gamma", "repairer"),
  delta: agent("delta", "diagnostician"),
  epsilon: agent("epsilon", "repairer"),
  kappa: agent("kappa", "challenger"),
  verifier: agent("verifier", "verifier"),
} as const;

export type RosterName = keyof typeof roster;

export const publicKeys: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(roster).map((member) => [member.agentId, member.key.publicKey]),
);
