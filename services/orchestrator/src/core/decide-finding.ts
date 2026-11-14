import { fail, succeed, type Digest } from "@backstop/shared";
import type { Decision } from "./commands.js";
import type { TaskRecord } from "./record.js";

const openStates = new Set(["ASSIGNED", "RECOVERY_ASSIGNED", "EXECUTING"]);

export function decideFinding(
  record: TaskRecord,
  agentId: string,
  attempt: number,
  findingHash: Digest,
  failingCases: readonly string[],
): Decision {
  const assignment = record.assignment;
  if (assignment === null || attempt !== record.attempt || !openStates.has(record.state)) {
    return fail(
      "STALE_STATE",
      `Attempt ${String(attempt)} is not the open attempt in ${record.state}`,
    );
  }
  if (!assignment.bid.bid.members.some((member) => member.agentId === agentId)) {
    return fail("UNAUTHORIZED", `${agentId} is not in the bid assigned to this attempt`);
  }
  if (record.findings.some((entry) => entry.attempt === attempt && entry.agentId === agentId)) {
    return fail("DUPLICATE", `${agentId} already posted a finding for this attempt`);
  }
  return succeed([
    { type: "finding_recorded", attempt, agentId, findingHash, failingCases: [...failingCases] },
  ]);
}
