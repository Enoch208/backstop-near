import type { FailureCode } from "@backstop/shared";

const statusByCode: Readonly<Record<FailureCode, number>> = {
  INVALID_SCHEMA: 400,
  BAD_SIGNATURE: 401,
  UNAUTHORIZED: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  STALE_STATE: 409,
  STALE_LEASE: 409,
  LEASE_HELD: 409,
  DUPLICATE: 409,
  ALREADY_SETTLED: 409,
  POLICY_VIOLATION: 422,
  BUDGET_EXCEEDED: 422,
  LIABILITY_EXCEEDED: 422,
  INSUFFICIENT_FUNDS: 422,
  BID_WINDOW_CLOSED: 422,
  CHALLENGE_WINDOW_CLOSED: 422,
  TRANSFER_NOT_RETRYABLE: 422,
};

export type ApiError = {
  readonly code: FailureCode | "ROUTE_NOT_FOUND" | "METHOD_NOT_ALLOWED" | "DEMO_DISABLED";
  readonly message: string;
  readonly status: number;
  readonly retryable: boolean;
};

export function failure(code: FailureCode, message: string): ApiError {
  return { code, message, status: statusByCode[code], retryable: code === "STALE_STATE" };
}

const plain = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

export function toJson(value: unknown): string {
  return JSON.stringify(value, plain);
}

export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(toJson(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function errorResponse(
  error: ApiError,
  traceId: string,
  taskVersion: number | null,
): Response {
  return json(
    {
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        traceId,
        taskVersion,
      },
    },
    error.status,
  );
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 256_000) throw new RangeError("The request body is too large");
  return JSON.parse(text) as unknown;
}
