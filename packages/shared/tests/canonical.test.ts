import { describe, expect, it } from "vitest";
import { canonicalJson, digestOf } from "../src/index.js";

describe("canonicalJson", () => {
  it("sorts keys at every depth so equal values hash equally", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 0, y: 1 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":1,"z":0}]},"b":1}',
    );
    expect(digestOf({ x: 1, y: 2 })).toBe(digestOf({ y: 2, x: 1 }));
  });

  it("drops undefined fields and refuses values JSON cannot carry", () => {
    expect(canonicalJson({ kept: 1, dropped: undefined })).toBe('{"kept":1}');
    expect(() => canonicalJson({ amount: 1n })).toThrow(TypeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
  });

  it("prefixes digests with their algorithm", () => {
    expect(digestOf("backstop")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
