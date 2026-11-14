import { type FixtureAgent, type PricingProfile } from "@backstop/agents";
import {
  agentIdSchema,
  near,
  nearAccountSchema,
  signValue,
  signingKeyFromSeed,
} from "@backstop/shared";
import { z } from "zod";

const configuration = z.object({
  BACKSTOP_WORKER_SEED: z.string().min(32),
  BACKSTOP_WORKER_FLOOR_NEAR: z.string().regex(/^\d+(?:\.\d{1,24})?$/),
  BACKSTOP_WORKER_RISK_BPS: z.coerce.number().int().min(0).max(100_000).default(20_000),
  BACKSTOP_WORKER_CAPACITY: z.coerce.number().int().min(1).max(100).default(10),
  BACKSTOP_WORKER_MS_PER_UNIT: z.coerce.number().int().min(1).max(120_000).default(10_000),
});

export function externalWorker(
  id: string,
  account: string,
): {
  agent: FixtureAgent;
  profile: PricingProfile;
} {
  const parsed = configuration.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Invalid worker configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  const settings = parsed.data;
  const floorPerUnitYocto = near(settings.BACKSTOP_WORKER_FLOOR_NEAR);
  if (floorPerUnitYocto <= 0n) throw new Error("The worker price floor must be positive");
  return {
    agent: {
      agentId: agentIdSchema.parse(id),
      account: nearAccountSchema.parse(account),
      role: "repairer",
      key: signingKeyFromSeed(settings.BACKSTOP_WORKER_SEED),
    },
    profile: {
      floorPerUnitYocto,
      riskAppetiteBps: settings.BACKSTOP_WORKER_RISK_BPS,
      capacityUnits: settings.BACKSTOP_WORKER_CAPACITY,
      msPerUnit: settings.BACKSTOP_WORKER_MS_PER_UNIT,
    },
  };
}

export async function registerWorker(api: string, agent: FixtureAgent): Promise<void> {
  const claim = {
    agentId: agent.agentId,
    account: agent.account,
    role: agent.role,
    publicKey: agent.key.publicKey,
  };
  const reply = await fetch(`${api}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claim, proof: signValue(claim, agent.key) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!reply.ok) throw new Error(`Agent registration refused (HTTP ${String(reply.status)})`);
  await reply.body?.cancel();
}
