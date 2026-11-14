import { describe, expect, it } from "vitest";
import { nearAmount } from "../src/data/near.js";
import { enclaveKey, liveRun, record } from "../src/data/record.js";

describe("the page's data", () => {
  it("reads the recorded live run and enclave key from deployments/testnet.json", () => {
    expect(record.contractId).toBe("vault.backstop-6501bb.testnet");
    expect(liveRun.steps.some((step) => step.label.includes("TEE signature"))).toBe(true);
    expect(liveRun.steps.at(-1)?.outcome).toBe("refused ERR_ALREADY_SETTLED");
    expect(enclaveKey.signingAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("formats yoctoNEAR without floating point", () => {
    expect(nearAmount("690000000000000000000000")).toBe("0.69");
    expect(nearAmount("1300000000000000000000000")).toBe("1.30");
    expect(nearAmount("0")).toBe("0.00");
    expect(nearAmount("999999999999999999999999", 4)).toBe("0.9999");
  });
});
