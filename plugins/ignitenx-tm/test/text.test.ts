import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  REDACTED,
  charCount,
  containsSecret,
  findQuote,
  hiddenClass,
  isFreeText,
  isSpace,
  normalizeText,
  redact,
  redactRaw,
  textCode,
  trimSpace,
  type Count,
} from "../src/text.js";

// Byte copy of TM's spec/testdata/text-vectors.json; TM pins the same hash, so update both together.
const VECTORS_URL = new URL("./fixtures/text-vectors.json", import.meta.url);
const VECTORS_SHA256 = "sha256:a229d937f85835fac0815f752bcd8fb0caa65473a510415ef499dd03c6844833";

interface Vector {
  name: string;
  input: string;
  normalised: string;
  stripped?: Record<string, number>;
  redacted?: string;
  redactions?: Record<string, number>;
}

const raw = readFileSync(VECTORS_URL);
const vectors = JSON.parse(raw.toString("utf8")) as Vector[];
const countMap = (counts: Count[]) => Object.fromEntries(counts.map((c) => [c.code, c.count]));
const long = (n: number) => "a".repeat(n);
const tmk = `tmk_0123456789abcdef_${"A".repeat(43)}`;

describe("text vectors shared with TM", () => {
  test("the fixture is TM's file, byte for byte", () => {
    expect(`sha256:${createHash("sha256").update(raw).digest("hex")}`).toBe(VECTORS_SHA256);
    expect(vectors.length).toBeGreaterThanOrEqual(20);
  });

  test.each(vectors.map((v) => [v.name, v] as const))("%s", (_, v) => {
    const n = normalizeText(v.input);
    expect(n.text).toBe(v.normalised);
    expect(countMap(n.stripped)).toEqual(v.stripped ?? {});
    const r = redact(n.text);
    expect(r.text).toBe(v.redacted ?? v.normalised);
    expect(countMap(r.redactions)).toEqual(v.redactions ?? {});
    expect(normalizeText(n.text)).toEqual({ text: n.text, stripped: [] });
    const rr = redactRaw(v.input);
    expect(normalizeText(rr.text)).toEqual({ text: r.text, stripped: n.stripped });
    expect(rr.redactions).toEqual(r.redactions);
  });
});

describe("normalizeText", () => {
  test.each([
    ["a\ud800b", "a\ufffdb"],
    ["\udc00", "\ufffd"],
    ["x\ud83d", "x\ufffd"],
  ])("reads the lone surrogate in %j as the U+FFFD TM receives", (s, want) => {
    expect(normalizeText(s)).toEqual({ text: want, stripped: [] });
  });

  test("counts hidden classes in TM's order", () => {
    const n = normalizeText("\u{e0100}a\u{e0041}\u200b\u202e\u0007");
    expect(n.text).toBe("a");
    expect(n.stripped).toEqual([
      { code: "control", count: 1 },
      { code: "bidi_control", count: 1 },
      { code: "zero_width", count: 1 },
      { code: "tag_character", count: 1 },
      { code: "variation_selector", count: 1 },
    ]);
  });

  test("trims TM's whitespace set, not JavaScript's", () => {
    expect(trimSpace("\u00a0\u3000x\u2009\n")).toBe("x");
    expect(trimSpace("\u000bx\u000c")).toBe("\u000bx\u000c");
    expect(normalizeText("\ufeff\u000bx\u0085").text).toBe("x");
    expect(isSpace("\u205f")).toBe(true);
    expect(isSpace("\u200b")).toBe(false);
    expect(hiddenClass(0x180e)).toBe("zero_width");
    expect(hiddenClass(0xfe0f)).toBe("");
  });

  test("counts code points", () => {
    expect(charCount("a\u{1f600}வ்")).toBe(4);
    expect(charCount("\ud800")).toBe(1);
  });
});

describe("containsSecret and redact", () => {
  test.each([
    "password=hunter22",
    tmk,
    "AKIAIOSFODNN7EXAMPLE",
    "https://u:p4ss@host",
    "Token: abcdef",
    "PAſſWORD: hunter22",
    "api\u212aey = abcdef",
  ])("%j is a secret", (s) => {
    expect(containsSecret(s)).toBe(true);
  });

  test.each(["Acme Learning Pvt Ltd", "priya.n@acmelearning.in", "RC-4471", "password reset flow", REDACTED])(
    "%j is not a secret",
    (s) => {
      expect(containsSecret(s)).toBe(false);
    },
  );

  test("repeats until nothing matches: a key glued to a label", () => {
    expect(redact(`${tmk}token: hunter22`)).toEqual({
      text: `${REDACTED}token: ${REDACTED}`,
      redactions: [
        { code: "tm_agent_key", count: 1 },
        { code: "password_line", count: 1 },
      ],
    });
    const once = redact(`x ${tmk}sk-proj-abcdefghijklmnopqrstuvwx`);
    expect(once.text).toBe(`x ${REDACTED}${REDACTED}`);
    expect(redact(once.text)).toEqual({ text: once.text, redactions: [] });
  });

  test("orders redactions by pattern, not by position", () => {
    const r = redact(`password: Welcome@123 and AKIAIOSFODNN7EXAMPLE and ${tmk}`);
    expect(r.redactions.map((c) => c.code)).toEqual(["tm_agent_key", "aws_access_key", "password_line"]);
  });

  test("stays linear on a 50,000-character source built to make a backtracking regex quadratic", () => {
    const fill = (unit: string) => unit.repeat(Math.ceil(50_000 / unit.length)).slice(0, 50_000);
    const started = performance.now();
    for (const s of [fill("a1"), `x://${fill("a")}`, fill("eyJ"), fill("token:"), `-----BEGIN ${fill("A")}`]) {
      redact(s);
      redactRaw(s);
    }
    expect(performance.now() - started).toBeLessThan(1500);
  });

  test("\\b stays ASCII next to the characters RE2 folds", () => {
    expect(redact("ſsk-abcdefghijklmnopqrstuvwx").text).toBe(`ſ${REDACTED}`);
    expect(redact("\u212ask-abcdefghijklmnopqrstuvwx").text).toBe(`\u212a${REDACTED}`);
    expect(redact("Ksk-abcdefghijklmnopqrstuvwx").text).toBe("Ksk-abcdefghijklmnopqrstuvwx");
  });
});

describe("redactRaw", () => {
  test.each([
    ["no secret", "\u202eAcme\r\n Learning\u200b ", "\u202eAcme\r\n Learning\u200b "],
    [
      "hidden characters inside a secret follow the token",
      "pass\u200bword: hun\u200bter22 ok",
      `pass\u200bword: ${REDACTED}\u200b ok`,
    ],
    ["a key split by a hidden character", `x ${tmk.slice(0, 30)}\u{e0041}${tmk.slice(30)}.`, `x ${REDACTED}\u{e0041}.`],
    ["line endings and trimmed ends stay", "\u200b token:\r\nabcd\u202e \r", `\u200b token:\r\n${REDACTED}\u202e \r`],
    [
      "CRLF inside a secret goes with it",
      "-----BEGIN PRIVATE KEY-----\r\nMIIB\r\n-----END PRIVATE KEY-----\r\nnext",
      `${REDACTED}\r\nnext`,
    ],
    [
      "a CR inside a secret is not kept as a hidden character",
      "-----BEGIN PRIVATE KEY-----\r\u00adMIIB-----END PRIVATE KEY----- next",
      `${REDACTED}\u00ad next`,
    ],
    ["a lone surrogate becomes U+FFFD", "a\ud800b password=hunter22", `a\ufffdb password=${REDACTED}`],
  ])("%s", (_, input, want) => {
    const r = redactRaw(input);
    expect(r.text).toBe(want);
    const n = normalizeText(input);
    const red = redact(n.text);
    expect(normalizeText(r.text)).toEqual({ text: red.text, stripped: n.stripped });
    expect(r.redactions).toEqual(red.redactions);
  });

  test("keeps the paste's trailing whitespace outside a secret that runs to the end of the text", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\r\nMIIB \r\n\r\n";
    expect(redactRaw(pem).text).toBe(`${REDACTED} \r\n\r\n`);
  });

  test("repeats passes as redact does", () => {
    const input = `x ${tmk}\u200bsk-proj-abcdefghijklmnopqrstuvwx`;
    expect(redactRaw(input)).toEqual({
      text: `x ${REDACTED}\u200b${REDACTED}`,
      redactions: [
        { code: "tm_agent_key", count: 1 },
        { code: "openai_key", count: 1 },
      ],
    });
    expect(redact(normalizeText(input).text).text).toBe(`x ${REDACTED}${REDACTED}`);
  });

  test("agrees with redact on normalised text for generated inputs", () => {
    const failures: { input: string; got: unknown; want: unknown }[] = [];
    let redacted = 0;
    let hiddenInside = 0;
    for (const input of generate(4000, 20260929)) {
      const r = redactRaw(input);
      const n = normalizeText(input);
      const red = redact(n.text);
      const got = { ...normalizeText(r.text), redactions: r.redactions, wellFormed: !/\p{Cs}/u.test(r.text) };
      const want = { text: red.text, stripped: n.stripped, redactions: red.redactions, wellFormed: true };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        failures.push({ input, got, want });
      }
      redacted += red.redactions.length > 0 ? 1 : 0;
      hiddenInside += hiddenAfterToken(r.text) ? 1 : 0;
    }
    expect(failures.slice(0, 3)).toEqual([]);
    expect(redacted).toBeGreaterThan(2000);
    expect(hiddenInside).toBeGreaterThan(1000);
  });
});

describe("findQuote", () => {
  test.each([
    ["Our Chennai office runs it", "Chennai office", { start: 4, end: 18 }],
    ["Our Chennai\n   office", "Chennai office", { start: 4, end: 21 }],
    ["Our Chennai office", "Chennai\t\n office", { start: 4, end: 18 }],
    ["a\u00a0b", "a b", { start: 0, end: 3 }],
    ["வணக்கம் குழு", "குழு", { start: 8, end: 12 }],
    ["\u{1f600}\u{1f389} go \u{1f680} now", "go \u{1f680}", { start: 3, end: 7 }],
    ["first a b then a b", "a b", { start: 6, end: 9 }],
    ["x  y", " x y ", { start: 0, end: 4 }],
    ["Case Matters", "case matters", null],
    ["abc", "abcd", null],
    ["abc", "   ", null],
    ["ab", "a b", null],
  ])("findQuote(%j, %j)", (text, quote, want) => {
    expect(findQuote(text, quote)).toEqual(want);
  });
});

describe("isFreeText and textCode", () => {
  test.each([
    ["Johnson & Johnson", ""],
    ["Naukri.com", ""],
    ["Acme Pvt. Ltd/India", ""],
    ["Hotel: Grand Profile: Acme", ""],
    ["வணக்கம் \u2764\ufe0f", ""],
    [long(100), ""],
    [long(101), "length"],
    ["", "length"],
    ["Acme\tLearning", "free_text"],
    [" Acme", "free_text"],
    ["WWW.acme.in", "free_text"],
    ["Acme `x`", "free_text"],
    ["Acme <b>", "free_text"],
    ["Acme zoom.us/j/8123", "free_text"],
    ["Acme tel:+911234", "free_text"],
    ["Acme //10.0.0.1/x", "free_text"],
    ["Acme gopher://10.0.0.1", "free_text"],
    ["[Acme](acme)", "free_text"],
    ["a\u00a0b", "free_text"],
    ["a\u200bb", "free_text"],
    ["HTTPſ: x", "free_text"],
    ["ſhttp: x", "free_text"],
    ["xhttp: x", ""],
  ])("textCode(%j, 100) = %j", (s, code) => {
    expect(textCode(s, 100)).toBe(code);
    expect(isFreeText(s)).toBe(code !== "free_text");
  });

  test("a lone surrogate is checked as the U+FFFD TM receives", () => {
    expect(isFreeText("a\ud800b")).toBe(true);
    expect(findQuote("\u{1f600}", "\ude00")).toBeNull();
  });
});

// hiddenAfterToken reports a hidden character right after a redaction token, where redactRaw puts those it replaced.
const hiddenAfterToken = (s: string) =>
  s
    .split(REDACTED)
    .slice(1)
    .some((rest) => !rest.startsWith("\r") && hiddenClass(rest.codePointAt(0) ?? 0x20) !== "");

// generate builds pasted-looking text from TM's secret shapes, then sprinkles hidden characters and CRs anywhere,
// including inside secrets, so a secret's raw range holds characters that normalising removes.
function generate(count: number, seed: number): string[] {
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(rand() * n);
  const pick = <T>(a: readonly T[]): T => a[int(a.length)] as T;
  const cp = (a: number, b = a) => String.fromCodePoint(a + int(b - a + 1));
  const str = (alphabet: string, n: number) =>
    Array.from({ length: n }, () => alphabet[int(alphabet.length)]).join("");
  const near = (n: number) => Math.max(0, n + pick([-1, 0, 0, 0, 1]));
  const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const ALNUM = `${UPPER}abcdefghijklmnopqrstuvwxyz`;
  const B64URL = `${ALNUM}_-`;
  const HEX = "0123456789abcdef";
  const SPACES = [" ", " ", "\t", "\n", "\u00a0", "\u1680", "\u2003", "\u2028", "\u202f", "\u205f", "\u3000"];
  const BREAKS = ["\r", "\r\n", "\n\r", "\r\r\n", "\u000b", "\u0085"];
  const LABELS = ["password", "Password", "PWD", "passwd", "secret", "api_key", "api key", "apiKey", "token"];
  const hidden = () =>
    pick([
      () => cp(0x00, 0x1f),
      () => cp(0x7f, 0x9f),
      () => cp(0x202a, 0x202e),
      () => cp(0x2066, 0x2069),
      () => pick(["\u200e", "\u200f", "\u061c", "\u00ad", "\u180e", "\ufeff"]),
      () => cp(0x200b, 0x200d),
      () => cp(0x2060, 0x2064),
      () => cp(0xe0000, 0xe007f),
      () => cp(0xe0100, 0xe01ef),
      () => pick(["\ufe0f", "\u2065", "\u180d", "\u{e0080}", "\u2029"]),
    ])();
  const labelled = () =>
    pick(LABELS) +
    pick(["", '"']) +
    pick(["", " ", "\t"]) +
    pick([":", "="]) +
    pick(["", " "]) +
    pick([str(`${ALNUM}@#`, 1 + int(10)), REDACTED, `${pick(LABELS)}:`, "\u{1f600}\u{1f600}ab", "குழு"]);
  const secret = () =>
    pick([
      () => `tmk_${str(HEX, near(16))}_${str(B64URL, near(43))}`,
      () => `inx_acme_${str(ALNUM, 2)}_0f8fad5b-d9cb-469f-a165-${str(HEX, near(12))}`,
      () => `eyJ${str(B64URL, near(8))}.${str(B64URL, near(9))}.${str(B64URL, near(10))}`,
      () => `${pick(["https", "mongodb+srv", "x"])}://${str(ALNUM, 1 + int(5))}:${str(`${ALNUM}!`, 1 + int(8))}@h`,
      () => `${pick(["AccountKey", "accountkey", "SharedAccessSignature"])}=${str(`${ALNUM}+/=`, 1 + int(20))};`,
      () => `${pick(["?", "&"])}sig=${str(`${ALNUM}%/+=`, near(16))}`,
      () => `${pick(["", " ", "x", "ſ"])}sk-${pick(["", "ant-", "proj-"])}${str(B64URL, near(20))}`,
      () => `${pick(["", " ", "x"])}AKIA${str(UPPER, near(16))}${pick(["", " ", "x"])}`,
      () => `ghp_${str(ALNUM, near(36))}`,
      () => `github_pat_${str(`${ALNUM}_`, near(22))}`,
      () => `-----BEGIN PRIVATE KEY-----\n${str(`${B64URL}\n`, int(20))}${pick(["", "-----END PRIVATE KEY-----"])}`,
      labelled,
      () => REDACTED,
    ])();
  const fragment = () =>
    pick([
      () => str(`${ALNUM} .,;:!?'"-()/@#&*+=`, 1 + int(16)),
      () => pick(SPACES),
      () => pick(BREAKS),
      hidden,
      () => pick(["\u{1f600}", "\u2764\ufe0f", "\u{1f469}\u200d\u{1f4bb}", "வணக்கம்", "சென்னை", "Acme Learning"]),
      secret,
      secret,
      secret,
      () => Array.from({ length: 2 + int(3) }, secret).join(""),
      () => cp(0x20, 0x2fff),
      () => cp(0x10000, 0x1ffff),
      () => pick(["\ud800", "\udc00"]),
    ])();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const chars = [...Array.from({ length: 1 + int(10) }, fragment).join(pick(["", " ", "\n"]))];
    for (let k = int(3) === 0 ? 0 : 1 + int(6); k > 0; k--) {
      chars.splice(int(chars.length + 1), 0, int(4) === 0 ? pick(BREAKS) : hidden());
    }
    out.push(chars.join(""));
  }
  return out;
}
