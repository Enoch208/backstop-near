import { z } from "zod";
import { signatureSchema, signValue, verifyValue, type SigningKey } from "./signing.js";

export const jsonSchema = z.json();
export type Json = z.infer<typeof jsonSchema>;

export const signedRequestSchema = z.strictObject({
  actor: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/),
  requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  issuedAtMs: z.int().min(0),
  body: jsonSchema,
  signature: signatureSchema,
});
export type SignedRequest = z.infer<typeof signedRequestSchema>;

export type RequestScope = { readonly method: string; readonly path: string };

const signedPart = (request: Omit<SignedRequest, "signature">, scope: RequestScope) => ({
  actor: request.actor,
  requestId: request.requestId,
  issuedAtMs: request.issuedAtMs,
  method: scope.method,
  path: scope.path,
  body: request.body,
});

export function signRequest(
  unsigned: Omit<SignedRequest, "signature">,
  scope: RequestScope,
  key: SigningKey,
): SignedRequest {
  return { ...unsigned, signature: signValue(signedPart(unsigned, scope), key) };
}

export function isAuthenticRequest(
  request: SignedRequest,
  scope: RequestScope,
  publicKey: string,
): boolean {
  return (
    request.signature.publicKey === publicKey &&
    verifyValue(signedPart(request, scope), request.signature)
  );
}
