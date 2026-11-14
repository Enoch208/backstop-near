import {
  bidHash,
  bidSchema,
  digestOf,
  near,
  signValue,
  toYocto,
  type Bid,
  type Endorsement,
  type SignedBid,
} from "@backstop/shared";
import type { PricedAgent, Quote } from "./pricing.js";
import { pricingProfile, roster, type FixtureAgent } from "./roster.js";

export type BidContext = {
  readonly taskId: string;
  readonly epoch: number;
  readonly nowMs: number;
  readonly bidWindowMs: number;
  readonly excludedAgents: readonly string[];
};

type Offer = {
  readonly lead: FixtureAgent;
  readonly members: readonly { agent: FixtureAgent; share: string }[];
  readonly durationMs: number;
  readonly plan: string;
};

export const fixtureOffers: readonly Offer[] = [
  {
    lead: roster.beta,
    members: [{ agent: roster.beta, share: "0.30" }],
    durationMs: 45_000,
    plan: "Move all money math to integer cents and round half up.",
  },
  {
    lead: roster.gamma,
    members: [
      { agent: roster.gamma, share: "0.40" },
      { agent: roster.delta, share: "0.12" },
    ],
    durationMs: 60_000,
    plan: "Delta diagnoses every failing rule from the checkpoint; Gamma rewrites the totals in integer cents and re-derives the free-shipping boundary.",
  },
  {
    lead: roster.epsilon,
    members: [{ agent: roster.epsilon, share: "0.80" }],
    durationMs: 30_000,
    plan: "Rewrite the checkout module from scratch.",
  },
];

export function signBid(bid: Bid, lead: FixtureAgent): SignedBid {
  const parsed = bidSchema.parse(bid);
  return {
    bid: parsed,
    bidHash: bidHash(parsed),
    signature: signValue(parsed, lead.key),
    endorsements: [],
  };
}

export function endorsement(signed: SignedBid, member: FixtureAgent): Endorsement {
  return { agentId: member.agentId, signature: signValue(signed.bid, member.key) };
}

export function endorseBid(signed: SignedBid, member: FixtureAgent): SignedBid {
  return { ...signed, endorsements: [...signed.endorsements, endorsement(signed, member)] };
}

export function fixtureBids(context: BidContext): SignedBid[] {
  return fixtureOffers
    .filter(
      (offer) => !offer.members.some(({ agent }) => context.excludedAgents.includes(agent.agentId)),
    )
    .map((offer, index) => {
      const members = offer.members.map(({ agent, share }) => ({
        agentId: agent.agentId,
        account: agent.account,
        role: agent.role,
        shareYocto: toYocto(near(share)),
      }));
      const amount = offer.members.reduce((total, { share }) => total + near(share), 0n);
      return signBid(
        {
          taskId: context.taskId,
          epoch: context.epoch,
          members,
          amountYocto: toYocto(amount),
          estimatedDurationMs: offer.durationMs,
          planHash: digestOf(offer.plan),
          committedAtMs: context.nowMs + 1_000 * (index + 1),
          expiresAtMs: context.nowMs + context.bidWindowMs + 60_000,
        },
        offer.lead,
      );
    });
}

export type RecoveryTeam = { readonly team: readonly PricedAgent[]; readonly plan: string };

export function recoveryTeam(leadId: string): RecoveryTeam | null {
  const offer = fixtureOffers.find((candidate) => candidate.lead.agentId === leadId);
  if (offer === undefined) return null;
  return {
    plan: offer.plan,
    team: offer.members.map(({ agent }) => ({ agent, profile: pricingProfile(agent.agentId) })),
  };
}

export type PricedOffer = Extract<Quote, { kind: "offer" }>;

export function pricedBid(
  context: Omit<BidContext, "excludedAgents">,
  plan: string,
  offer: PricedOffer,
): SignedBid {
  const [lead] = offer.members;
  if (lead === undefined) throw new RangeError("A priced offer has at least one member");
  return signBid(
    {
      taskId: context.taskId,
      epoch: context.epoch,
      members: offer.members.map(({ agent, shareYocto }) => ({
        agentId: agent.agentId,
        account: agent.account,
        role: agent.role,
        shareYocto: toYocto(shareYocto),
      })),
      amountYocto: toYocto(offer.amountYocto),
      estimatedDurationMs: offer.estimatedDurationMs,
      planHash: digestOf(plan),
      committedAtMs: context.nowMs,
      expiresAtMs: context.nowMs + context.bidWindowMs + 60_000,
    },
    lead.agent,
  );
}

export function primaryBid(
  lead: FixtureAgent,
  taskId: string,
  share: string,
  nowMs: number,
): SignedBid {
  return signBid(
    {
      taskId,
      epoch: 0,
      members: [
        {
          agentId: lead.agentId,
          account: lead.account,
          role: "executor",
          shareYocto: toYocto(near(share)),
        },
      ],
      amountYocto: toYocto(near(share)),
      estimatedDurationMs: 60_000,
      planHash: digestOf(`${lead.agentId} repairs the checkout totals`),
      committedAtMs: nowMs,
      expiresAtMs: nowMs + 60_000,
    },
    lead,
  );
}
