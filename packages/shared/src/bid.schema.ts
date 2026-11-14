import { z } from "zod";
import { fromYocto, sumYocto, yoctoSchema } from "./amount.js";
import { digestOf, digestSchema, type Digest } from "./canonical.js";
import { agentIdSchema, nearAccountSchema, taskIdSchema } from "./ids.js";
import { signatureSchema } from "./signing.js";
import { agentRoles } from "./task-state.js";

export const bidMemberSchema = z.strictObject({
  agentId: agentIdSchema,
  account: nearAccountSchema,
  role: z.enum(agentRoles),
  shareYocto: yoctoSchema,
});
export type BidMember = z.infer<typeof bidMemberSchema>;

export const bidSchema = z
  .strictObject({
    taskId: taskIdSchema,
    epoch: z.int().min(0),
    members: z.array(bidMemberSchema).min(1).max(5),
    amountYocto: yoctoSchema,
    estimatedDurationMs: z.int().min(1),
    planHash: digestSchema,
    committedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(0),
  })
  .refine(
    (bid) =>
      sumYocto(bid.members.map((member) => fromYocto(member.shareYocto))) ===
      fromYocto(bid.amountYocto),
    "Member shares must add up to the bid amount",
  )
  .refine(
    (bid) => new Set(bid.members.map((member) => member.agentId)).size === bid.members.length,
    "A bid names each agent once",
  );
export type Bid = z.infer<typeof bidSchema>;

export const endorsementSchema = z.strictObject({
  agentId: agentIdSchema,
  signature: signatureSchema,
});
export type Endorsement = z.infer<typeof endorsementSchema>;

export const signedBidSchema = z.strictObject({
  bid: bidSchema,
  bidHash: digestSchema,
  signature: signatureSchema,
  endorsements: z.array(endorsementSchema).max(4),
});
export type SignedBid = z.infer<typeof signedBidSchema>;

export function bidHash(bid: Bid): Digest {
  return digestOf(bid);
}

export function leadAgent(bid: Bid): string {
  const [lead] = bid.members;
  if (lead === undefined) throw new RangeError("A bid has at least one member");
  return lead.agentId;
}

export function pendingEndorsers(signed: SignedBid): string[] {
  const lead = leadAgent(signed.bid);
  const endorsed = new Set(signed.endorsements.map((endorsement) => endorsement.agentId));
  return signed.bid.members
    .map((member) => member.agentId)
    .filter((agentId) => agentId !== lead && !endorsed.has(agentId));
}
