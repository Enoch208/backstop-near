import { z } from "zod";

export const yoctoPerNear = 10n ** 24n;
export const u128Max = 2n ** 128n - 1n;

export const yoctoSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,38})$/)
  .refine((value) => BigInt(value) <= u128Max, "Amount exceeds u128");
export type YoctoString = z.infer<typeof yoctoSchema>;

export function toYocto(amount: bigint): YoctoString {
  if (amount < 0n || amount > u128Max)
    throw new RangeError(`Amount out of u128 range: ${amount.toString()}`);
  return amount.toString();
}

export function fromYocto(amount: YoctoString): bigint {
  return BigInt(amount);
}

export function near(decimal: string): bigint {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,24}))?$/.exec(decimal);
  if (match === null) throw new RangeError(`Not a NEAR amount: ${decimal}`);
  const [, whole = "0", fraction = ""] = match;
  return BigInt(whole) * yoctoPerNear + BigInt(fraction.padEnd(24, "0"));
}

export function formatNear(amount: bigint): string {
  const whole = amount / yoctoPerNear;
  const fraction = (amount % yoctoPerNear).toString().padStart(24, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

export function sumYocto(amounts: readonly bigint[]): bigint {
  return amounts.reduce((total, amount) => total + amount, 0n);
}

export function minYocto(...amounts: readonly bigint[]): bigint {
  return amounts.reduce((smallest, amount) => (amount < smallest ? amount : smallest));
}
