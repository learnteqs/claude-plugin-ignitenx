// The last step before anything reaches the model: every string in a result has the key, the tokens and anything that
// looks like a secret replaced. Results are already allowlisted, so this should never find anything.
import { REDACTED, redact } from "./text.js";

// Shorter literals are skipped: replacing them would garble ordinary text, and no key or token is that short.
const MIN_LITERAL = 16;

// scrub returns a copy of value; object keys and non-string values are kept as they are.
export function scrub<T>(value: T, literals: Iterable<string> = []): T {
  const known = [...literals].filter((s) => s.length >= MIN_LITERAL);
  return walk(value, known) as T;
}

function walk(value: unknown, literals: string[]): unknown {
  if (typeof value === "string") {
    return redact(literals.reduce((s, secret) => s.replaceAll(secret, REDACTED), value)).text;
  }
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, literals));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, literals)]));
  }
  return value;
}
