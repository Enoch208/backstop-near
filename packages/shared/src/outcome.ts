export const failureCodes = [
  "INVALID_SCHEMA",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "INVALID_TRANSITION",
  "STALE_STATE",
  "STALE_LEASE",
  "LEASE_HELD",
  "DUPLICATE",
  "POLICY_VIOLATION",
  "BUDGET_EXCEEDED",
  "LIABILITY_EXCEEDED",
  "INSUFFICIENT_FUNDS",
  "BID_WINDOW_CLOSED",
  "CHALLENGE_WINDOW_CLOSED",
  "ALREADY_SETTLED",
  "TRANSFER_NOT_RETRYABLE",
  "BAD_SIGNATURE",
] as const;
export type FailureCode = (typeof failureCodes)[number];

export type Failure = { readonly code: FailureCode; readonly message: string };

export type Outcome<T> = { ok: true; value: T } | { ok: false; failure: Failure };

export function succeed<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function fail<T>(code: FailureCode, message: string): Outcome<T> {
  return { ok: false, failure: { code, message } };
}
