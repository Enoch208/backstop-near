import {
  formatNear,
  fromYocto,
  near,
  pendingEndorsers,
  type AgentRole,
  type SignedBid,
} from "@backstop/shared";
import type { FixtureAgent } from "./roster.js";

export type JoinPolicy = { readonly minimumShare: bigint; readonly roles: readonly AgentRole[] };

export const joinPolicies: Readonly<Record<string, JoinPolicy>> = {
  delta: { minimumShare: near("0.10"), roles: ["diagnostician"] },
};

export type JoinDecision = { readonly join: boolean; readonly reason: string };

export function decideToJoin(
  agent: FixtureAgent,
  signed: SignedBid,
  excluded: readonly string[],
): JoinDecision {
  const seat = signed.bid.members.find((member) => member.agentId === agent.agentId);
  const policy = joinPolicies[agent.agentId];
  if (seat === undefined || !pendingEndorsers(signed).includes(agent.agentId)) {
    return { join: false, reason: "not invited, or already endorsed" };
  }
  if (policy === undefined) return { join: false, reason: "joins no coalitions" };
  if (!policy.roles.includes(seat.role))
    return { join: false, reason: `will not serve as ${seat.role}` };
  const share = fromYocto(seat.shareYocto);
  if (share < policy.minimumShare) {
    return {
      join: false,
      reason: `share ${formatNear(share)} NEAR is below its ${formatNear(policy.minimumShare)} NEAR minimum`,
    };
  }
  const tainted = signed.bid.members.find((member) => excluded.includes(member.agentId));
  if (tainted !== undefined)
    return { join: false, reason: `${tainted.agentId} already failed this task` };
  return { join: true, reason: `${formatNear(share)} NEAR as ${seat.role}` };
}
