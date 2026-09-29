import { describe, expect, test } from "vitest";

import { scrub } from "../src/scrub.js";
import { TEST_KEY, TEST_TOKEN } from "./fake-tm.js";

const JWT = `eyJhbGciOiJIUzI1NiJ9.${"eyJzdWIiOiJ4In0"}.${"c2lnbmF0dXJlLXZhbHVl"}`;

describe("scrub", () => {
  test("redacts what the secret patterns find in every string, however deep", () => {
    const value = {
      name: "Acme",
      notes: ["Password: Zenith@2026!", { dsn: "postgres://app:S3cr3t-pw@db.internal:5432/lms" }],
      nested: { deeper: [[`key ${TEST_KEY}`]], jwt: JWT },
    };
    expect(scrub(value)).toEqual({
      name: "Acme",
      notes: ["Password: [redacted]", { dsn: "postgres://app:[redacted]@db.internal:5432/lms" }],
      nested: { deeper: [["key [redacted]"]], jwt: "[redacted]" },
    });
  });

  test("replaces the given literals, which no pattern would find, before redacting", () => {
    const out = scrub({ message: `token ${TEST_TOKEN} was sent`, list: [TEST_TOKEN] }, [TEST_TOKEN]);
    expect(out).toEqual({ message: "token [redacted] was sent", list: ["[redacted]"] });
    expect(scrub(`x${TEST_TOKEN}${TEST_TOKEN}y`, new Set([TEST_TOKEN]))).toBe("x[redacted][redacted]y");
  });

  test("skips literals too short to be a key or token", () => {
    expect(scrub("plan-std in development", ["", "plan", "development"])).toBe("plan-std in development");
  });

  test("keeps keys, numbers, booleans and null, and returns a copy", () => {
    const value = { "Password: hunter22": 1, ok: true, none: null, n: 0.5, list: [1, "a"] };
    const out = scrub(value);
    expect(out).toEqual(value);
    expect(out).not.toBe(value);
    expect(out.list).not.toBe(value.list);
  });

  test("leaves the input unchanged", () => {
    const value = { a: ["Password: Zenith@2026!"] };
    scrub(value, [TEST_TOKEN]);
    expect(value).toEqual({ a: ["Password: Zenith@2026!"] });
  });

  test("leaves text without secrets exactly as it was", () => {
    const text = "Identity check failed (refused: the agent key holds access an agent must not have: db.view). Stop.";
    expect(scrub(text, [TEST_KEY, TEST_TOKEN])).toBe(text);
  });
});
