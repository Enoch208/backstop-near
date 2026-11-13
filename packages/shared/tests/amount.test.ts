import { describe, expect, it } from "vitest";
import { formatNear, near, toYocto, u128Max, yoctoSchema } from "../src/index.js";

describe("NEAR amounts", () => {
  it("converts decimal NEAR to exact yocto and back", () => {
    expect(near("0.40")).toBe(400_000_000_000_000_000_000_000n);
    expect(near("1")).toBe(10n ** 24n);
    expect(formatNear(near("0.52"))).toBe("0.52");
    expect(formatNear(0n)).toBe("0");
  });

  it("refuses malformed or out-of-range amounts", () => {
    expect(() => near("-1")).toThrow(RangeError);
    expect(() => near("0.1234567890123456789012345")).toThrow(RangeError);
    expect(() => toYocto(-1n)).toThrow(RangeError);
    expect(() => toYocto(u128Max + 1n)).toThrow(RangeError);
    expect(yoctoSchema.safeParse(u128Max.toString()).success).toBe(true);
    expect(yoctoSchema.safeParse((u128Max + 1n).toString()).success).toBe(false);
    expect(yoctoSchema.safeParse("007").success).toBe(false);
  });
});
