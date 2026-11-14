import { near, signingKeyFromSeed, type AgentRole, type SigningKey } from "@backstop/shared";
import type { PricingProfile } from "./pricing.js";

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

export const pricingProfiles: Readonly<Record<string, PricingProfile>> = {
  beta: {
    floorPerUnitYocto: near("0.10"),
    riskAppetiteBps: 20_000,
    capacityUnits: 3,
    msPerUnit: 20_000,
  },
  gamma: {
    floorPerUnitYocto: near("0.16"),
    riskAppetiteBps: 15_000,
    capacityUnits: 6,
    msPerUnit: 30_000,
  },
  delta: {
    floorPerUnitYocto: near("0.08"),
    riskAppetiteBps: 15_000,
    capacityUnits: 6,
    msPerUnit: 30_000,
  },
  epsilon: {
    floorPerUnitYocto: near("0.30"),
    riskAppetiteBps: 5_000,
    capacityUnits: 6,
    msPerUnit: 15_000,
  },
};

export function pricingProfile(agentId: string): PricingProfile {
  const profile = pricingProfiles[agentId];
  if (profile === undefined) throw new RangeError(`No pricing profile for ${agentId}`);
  return profile;
}

export const publicKeys: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(roster).map((member) => [member.agentId, member.key.publicKey]),
);

export type Principal = { readonly id: string; readonly account: string; readonly key: SigningKey };

const principal = (id: string): Principal => ({
  id,
  account: `${id}.fixture.testnet`,
  key: signingKeyFromSeed(`backstop-fixture-key:${id}`),
});

export const principals = {
  customer: principal("customer"),
  guarantor: principal("guarantor"),
  coordinator: principal("coordinator"),
} as const;

export function asPrincipal(agent: FixtureAgent): Principal {
  return { id: agent.agentId, account: agent.account, key: agent.key };
}

export const identities: readonly Principal[] = [
  ...Object.values(principals),
  ...Object.values(roster).map(asPrincipal),
];

export function rosterAgent(agentId: string): FixtureAgent {
  const agent = Object.values(roster).find((member) => member.agentId === agentId);
  if (agent === undefined) throw new RangeError(`No fixture agent ${agentId}`);
  return agent;
}

export type FixturePayout = {
  readonly label: string;
  readonly asset: string;
  readonly recipient: string;
  readonly recipientType: "DESTINATION_CHAIN" | "INTENTS";
};

export const payoutPreferences: Readonly<Record<string, FixturePayout>> = {
  delta: {
    label: "USDC on Base",
    asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    recipient: "0x6cf8227bbe2ef5f0b7bfd9aa62c3fd3da19d4d22",
    recipientType: "DESTINATION_CHAIN",
  },
};
