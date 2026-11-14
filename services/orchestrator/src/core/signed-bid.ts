import {
  bidHash,
  fail,
  leadAgent,
  signedBidSchema,
  succeed,
  verifyValue,
  type Endorsement,
  type Outcome,
  type SignedBid,
} from "@backstop/shared";
import type { Registry } from "./commands.js";
import type { TaskRecord } from "./record.js";

export function checkEndorsement(
  signed: SignedBid,
  endorsement: Endorsement,
  registry: Registry,
): string | null {
  const isMember = signed.bid.members.some((member) => member.agentId === endorsement.agentId);
  if (!isMember || endorsement.agentId === leadAgent(signed.bid)) {
    return `${endorsement.agentId} is not a member who must endorse this bid`;
  }
  const key = registry.agentKeys[endorsement.agentId];
  if (key === undefined || endorsement.signature.publicKey !== key) {
    return `The endorsement is not signed by ${endorsement.agentId}`;
  }
  return verifyValue(signed.bid, endorsement.signature)
    ? null
    : `${endorsement.agentId}'s endorsement does not match this bid`;
}

function checkEndorsements(signed: SignedBid, registry: Registry): string | null {
  const ids = signed.endorsements.map((endorsement) => endorsement.agentId);
  if (new Set(ids).size !== ids.length) return "A member endorsed twice";
  for (const endorsement of signed.endorsements) {
    const problem = checkEndorsement(signed, endorsement, registry);
    if (problem !== null) return problem;
  }
  return null;
}

export function checkSignedBid(
  record: TaskRecord,
  signed: SignedBid,
  registry: Registry,
): Outcome<SignedBid> {
  const parsed = signedBidSchema.safeParse(signed);
  if (!parsed.success) return fail("INVALID_SCHEMA", parsed.error.message);
  const { bid } = parsed.data;
  if (bid.taskId !== record.taskId) return fail("POLICY_VIOLATION", "The bid is for another task");
  if (bidHash(bid) !== parsed.data.bidHash)
    return fail("BAD_SIGNATURE", "The bid hash does not match");
  const leadKey = registry.agentKeys[leadAgent(bid)];
  if (leadKey === undefined) return fail("UNAUTHORIZED", `Unknown agent ${leadAgent(bid)}`);
  if (parsed.data.signature.publicKey !== leadKey || !verifyValue(bid, parsed.data.signature)) {
    return fail("BAD_SIGNATURE", "The bid is not signed by its lead agent");
  }
  const endorsementFailure = checkEndorsements(parsed.data, registry);
  if (endorsementFailure !== null) return fail("BAD_SIGNATURE", endorsementFailure);
  const excluded = bid.members.find((member) => record.excludedAgents.includes(member.agentId));
  if (excluded !== undefined) {
    return fail("POLICY_VIOLATION", `${excluded.agentId} already failed this task`);
  }
  return succeed(parsed.data);
}
