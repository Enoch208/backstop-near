import type { Principal } from "@backstop/agents";
import { signingKeyFromSeed, signValue } from "@backstop/shared";

export type OutsideAgent = Principal & { readonly role: "challenger" };

export function outsideAgent(seed: string | undefined, name: string | undefined): OutsideAgent {
  const id = name ?? `outside-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    account: `${id}.testnet`,
    key: signingKeyFromSeed(seed ?? crypto.randomUUID()),
    role: "challenger",
  };
}

export async function register(
  apiUrl: string,
  agent: OutsideAgent,
): Promise<{ status: number; body: unknown }> {
  const claim = {
    agentId: agent.id,
    account: agent.account,
    role: agent.role,
    publicKey: agent.key.publicKey,
  };
  const response = await fetch(`${apiUrl}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claim, proof: signValue(claim, agent.key) }),
  });
  return { status: response.status, body: await response.json() };
}
