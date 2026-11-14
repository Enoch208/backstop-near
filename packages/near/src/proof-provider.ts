import { JsonRpcProvider } from "near-api-js";

const readMethods = new Set(["query", "tx", "EXPERIMENTAL_tx_status"]);
const transientStatuses = new Set([408, 429, 500, 502, 503]);
const transientCodes = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function retryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (typeof error.cause === "number") return transientStatuses.has(error.cause);
  const cause = error.cause;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
  )
    return transientCodes.has(cause.code);
  return (
    error instanceof TypeError &&
    /^(fetch failed|failed to fetch|networkerror)/i.test(error.message)
  );
}

async function readWithBackoff<T>(request: (attempt: number) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(attempt);
    } catch (error) {
      if (attempt >= 5 || !retryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }
}

export class ProofProvider extends JsonRpcProvider {
  private readonly readers: readonly JsonRpcProvider[];
  private readerIndex = 0;

  constructor(urls: readonly string[]) {
    const first = urls[0];
    if (first === undefined) throw new Error("A proof RPC endpoint is required");
    super({ url: first }, { retries: 1 });
    this.readers = urls.map((url) => new JsonRpcProvider({ url }, { retries: 1 }));
  }

  override sendJsonRpc: JsonRpcProvider["sendJsonRpc"] = (method, params) => {
    if (!readMethods.has(method)) return super.sendJsonRpc(method, params);
    const start = this.readerIndex;
    return readWithBackoff((attempt) => {
      this.readerIndex = (start + attempt) % this.readers.length;
      const reader = this.readers[this.readerIndex];
      if (reader === undefined) throw new Error("Missing proof RPC endpoint");
      return reader.sendJsonRpc(method, params);
    });
  };
}
