import {
  bidHash,
  fail,
  leadAgent,
  signedBidSchema,
  succeed,
  verifyValue,
  type Outcome,
  type SignedBid,
} from "@backstop/shared";
import type { Registry } from "./commands.js";
import type { TaskRecord } from "./record.js";

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
  const excluded = bid.members.find((member) => record.excludedAgents.includes(member.agentId));
  if (excluded !== undefined) {
    return fail("POLICY_VIOLATION", `${excluded.agentId} already failed this task`);
  }
  return succeed(parsed.data);
}
