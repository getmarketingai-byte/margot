/**
 * Per-feed unguessable token generation. Tokens are URL-safe base64.
 */

import { randomBytes } from "node:crypto";

export function generateFeedToken(): string {
  return randomBytes(24).toString("base64url");
}
