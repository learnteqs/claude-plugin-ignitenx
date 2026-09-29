import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  REDACTED,
  charCount,
  containsHidden,
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
const VECTORS_SHA256 = "sha256:8585b997dd57514547fb4df3ad70e47b16eaa173a8eecc1cfe4341a1c79a5bd5";

interface Vector {
  name: string;
  input: string;
  normalised: string;
  stripped?: Record<string, number>;
  redacted?: string;
  redactions?: Record<string, number>;
  freeText?: boolean;
}

const raw = readFileSync(VECTORS_URL);
const vectors = JSON.parse(raw.toString("utf8")) as Vector[];
const countMap = (counts: Count[]) => Object.fromEntries(counts.map((c) => [c.code, c.count]));
const long = (n: number) => "a".repeat(n);
const tmk = `tmk_0123456789abcdef_${"A".repeat(43)}`;
const cps = (...codes: number[]) => String.fromCodePoint(...codes);
const VS16 = cps(0xfe0f);
const KEYCAP = cps(0x20e3);
const ZWSP = cps(0x200b);
const STAR = cps(0x2b50);

// selected lists, sorted, the code points a VS16 follows in s.
const selected = (s: string) => {
  const out = new Set<number>();
  for (let i = s.indexOf(VS16); i > 0; i = s.indexOf(VS16, i + 1)) {
    out.add(s.codePointAt(i - (s.charCodeAt(i - 1) >= 0xdc00 && s.charCodeAt(i - 1) <= 0xdfff ? 2 : 1)) ?? 0);
  }
  return [...out].sort((a, b) => a - b);
};
const selectorsCounted = (stripped: Count[]) => stripped.find((c) => c.code === "variation_selector")?.count ?? 0;

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
    expect(normalizeText(r.text)).toEqual({ text: r.text, stripped: [] });
    const rr = redactRaw(v.input);
    expect(normalizeText(rr.text)).toEqual({ text: r.text, stripped: n.stripped });
    expect(rr.redactions).toEqual(r.redactions);
    expect(typeof v.freeText, "every vector states TM's freeText verdict").toBe("boolean");
    expect(isFreeText(v.input)).toBe(v.freeText);
  });

  // The vectors that list the emoji bases and the colour emoji must list exactly the port's tables, so a port with
  // another table fails them.
  const listedIn = (name: string) => {
    const every = vectors.find((v) => v.name === name);
    expect(every, name).toBeDefined();
    return selected(every?.input ?? "");
  };
  const probe = (tail: string) => {
    const out: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp < 0xd800 || cp > 0xdfff) {
        out.push(" ", String.fromCodePoint(cp), tail);
      }
    }
    return out.join("");
  };

  test("the emoji bases are exactly those the vector lists", () => {
    const listed = listedIn("every emoji base keeps its selector");
    expect(listed.length).toBe(210);
    // Every code point in turn, after a space and before VS16 and U+20E3: VS16 stays exactly after an emoji base.
    expect(selected(normalizeText(probe(VS16 + KEYCAP)).text)).toEqual(listed);
  });

  test("the colour emoji are exactly those the vector lists", () => {
    const listed = listedIn("every colour emoji loses its selector quietly");
    expect(listed.length).toBe(161);
    for (const cp of listed) {
      expect(normalizeText(cps(cp, 0xfe0f)), cp.toString(16)).toEqual({ text: cps(cp), stripped: [] });
    }
    // Every code point in turn, after a space and before VS16: each VS16 is kept, counted, or removed quietly, and
    // only as many are removed quietly as the vector lists.
    const without = normalizeText(probe(""));
    const withVS16 = normalizeText(probe(VS16));
    const counted = selectorsCounted(withVS16.stripped) - selectorsCounted(without.stripped);
    const kept = withVS16.text.split(VS16).length - 1;
    expect(0x110000 - 0x800 - counted - kept).toBe(listed.length);
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

  test.each<[string, string, string, Count[]]>([
    ["removes a colour emoji's selector without counting it", STAR + VS16, STAR, []],
    [
      "counts every selector after the first",
      STAR + VS16 + VS16 + VS16,
      STAR,
      [{ code: "variation_selector", count: 2 }],
    ],
    [
      "judges the selector by the last kept character",
      `${STAR}${ZWSP}${VS16}${ZWSP}${VS16}`,
      STAR,
      [
        { code: "zero_width", count: 2 },
        { code: "variation_selector", count: 1 },
      ],
    ],
    ["removes a hand gesture's selector quietly", cps(0x270c, 0xfe0f, 0x20), cps(0x270c), []],
    [
      "counts a second selector after a text-style emoji",
      cps(0x2764, 0xfe0f, 0xfe0f),
      cps(0x2764, 0xfe0f),
      [{ code: "variation_selector", count: 1 }],
    ],
  ])("%s", (_, input, text, stripped) => {
    expect(normalizeText(input)).toEqual({ text, stripped });
    expect(normalizeText(text)).toEqual({ text, stripped: [] });
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

  // As TM's TestHiddenCoversIgnorables: the runtime's Unicode tables decide nothing in text.ts, but whatever version
  // this one has, each of its format, default-ignorable and variation-selector characters but VS16 is in the table.
  test("hides every format and default-ignorable character this runtime knows, but VS16", () => {
    const ignorable = /^[\p{Default_Ignorable_Code_Point}\p{Variation_Selector}\p{Cf}]$/u;
    const missed: string[] = [];
    for (let c = 0; c <= 0x10ffff; c++) {
      const known = (c < 0xd800 || c > 0xdfff) && c !== 0xfe0f && ignorable.test(cps(c));
      if (known && hiddenClass(c) === "") {
        missed.push(c.toString(16));
      }
    }
    expect(missed, `Unicode ${process.versions.unicode}`).toEqual([]);
  });

  test.each<[string, string, boolean]>([
    ["an emoji base keeps its selector", cps(0x2764, 0xfe0f), false],
    ["a base beyond the BMP keeps its selector", cps(0x1f170, 0xfe0f), false],
    ["a keycap keeps its selector", cps(0x23, 0xfe0f, 0x20e3), false],
    ["a selector after a letter is hidden", cps(0x41, 0xfe0f), true],
    ["a selector after a colour emoji is hidden", cps(0x2705, 0xfe0f), true],
    ["a selector after a hand gesture is hidden", cps(0x270c, 0xfe0f), true],
    ["a second selector is hidden", cps(0x2764, 0xfe0f, 0xfe0f), true],
    ["a digit's selector before another mark is hidden", cps(0x37, 0xfe0f, 0x20dd), true],
    ["a leading selector is hidden", cps(0xfe0f, 0x2764), true],
    ["a Hangul filler is hidden", cps(0x41, 0x3164), true],
    ["a CR is a control", cps(0x61, 0x0d, 0x62), true],
    ["a tab is not hidden", cps(0x61, 0x09, 0x62), false],
  ])("containsHidden: %s", (_, s, hidden) => {
    expect(containsHidden(s)).toBe(hidden);
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
    [
      "a selector the secret takes goes with the token",
      `Key sk-${long(20)}${cps(0x31, 0xfe0f, 0x20e3)} ok`,
      `Key ${REDACTED}${KEYCAP} ok`,
    ],
    [
      "a removed selector inside a secret follows the token",
      `password: Hunt${VS16}er2 ok`,
      `password: ${REDACTED}${VS16} ok`,
    ],
    [
      "a kept selector past a removed character goes with the token, and the removed one follows it",
      `sk-${long(20)}${cps(0x31, 0x200b, 0xfe0f, 0x20e3)}`,
      `${REDACTED}${cps(0x200b, 0x20e3)}`,
    ],
    ["a selector the secret leaves stays where it was", `AKIAIOSFODNN7EXAMPLE${VS16} x`, `${REDACTED}${VS16} x`],
    [
      "a selector removed quietly inside a secret does not follow the token",
      `password: Sun${STAR}${VS16}ny24 ok`,
      `password: ${REDACTED} ok`,
    ],
    [
      "a selector removed quietly after a secret's last character goes with it",
      `Password: Sunny2024${STAR}${VS16}`,
      `Password: ${REDACTED}`,
    ],
    [
      "so does one past a counted character, which follows the token",
      `Password: Sunny2024${STAR}${ZWSP}${VS16} ok`,
      `Password: ${REDACTED}${ZWSP} ok`,
    ],
    [
      "a counted selector after a secret stays after the token and is still counted",
      `Password: Sunny2024${STAR}${VS16}${VS16} ok`,
      `Password: ${REDACTED}${VS16} ok`,
    ],
    [
      "a URL password ending in a colour emoji takes its quiet selector",
      `x://u:pa${STAR}${VS16}@h`,
      `x://u:${REDACTED}@h`,
    ],
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

  // TM's FuzzNormalizeText and FuzzRedact properties, on the seeds TM added with the VS16 rule.
  test.each([
    cps(0x2764, 0xfe0f, 0xfe0f, 0x41, 0xfe0f, 0x20, 0x31, 0xfe0f, 0x20e3, 0x34f, 0xfe00),
    cps(0x23, 0xfe0f, 0x20e3, 0x31, 0xfe0f, 0x200b, 0x20e3, 0x37, 0xfe0f, 0x3d, 0xfe0f, 0x17b4, 0xe0f41, 0x600),
    `Key sk-${long(20)}${cps(0x31, 0xfe0f, 0x20e3)} ok`,
    `?sig=abcdefghijtoken=${VS16}abcd`,
  ])("TM's fuzz seed %j keeps every property", (input) => {
    const n = normalizeText(input);
    expect(containsHidden(n.text)).toBe(false);
    expect(normalizeText(n.text)).toEqual({ text: n.text, stripped: [] });
    const red = redact(n.text);
    expect(normalizeText(red.text)).toEqual({ text: red.text, stripped: [] });
    expect(containsSecret(redact(input).text)).toBe(false);
    const r = redactRaw(input);
    expect({ ...normalizeText(r.text), redactions: r.redactions }).toEqual({
      text: red.text,
      stripped: n.stripped,
      redactions: red.redactions,
    });
  });

  test("agrees with redact on normalised text for generated inputs", () => {
    const failures: { input: string; got: unknown; want: unknown }[] = [];
    let redacted = 0;
    let hiddenInside = 0;
    let selectorsTaken = 0;
    let quietTaken = 0;
    const selectors = (s: string) => s.split(VS16).length;
    // The VS16s normalizeText removes without counting: all it removes, less those it counts (its variation_selector
    // count, less the other selectors).
    const quiet = (s: string) => {
      const n = normalizeText(s);
      const others = [...s].filter((ch) => ch !== VS16 && hiddenClass(ch.codePointAt(0) ?? 0) === "variation_selector");
      return selectors(s) - selectors(n.text) - selectorsCounted(n.stripped) + others.length;
    };
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
      selectorsTaken += selectors(red.text) < selectors(n.text) ? 1 : 0;
      quietTaken += quiet(r.text) < quiet(input) ? 1 : 0;
    }
    expect(failures.slice(0, 3)).toEqual([]);
    expect(redacted).toBeGreaterThan(2000);
    expect(hiddenInside).toBeGreaterThan(1000);
    expect(selectorsTaken).toBeGreaterThan(100);
    expect(quietTaken).toBeGreaterThan(1000);
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
    .some((rest) => !rest.startsWith("\r") && containsHidden(`]${cps(rest.codePointAt(0) ?? 0x20)}`));

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
  // Both sides of every edge of the hidden table, and emoji bases of each kind with VS16 and U+20E3 around them.
  const EDGES: string[] = [];
  for (let c = 1; c <= 0x10ffff; c++) {
    if ((c < 0xd800 || c > 0xe000) && hiddenClass(c) !== hiddenClass(c - 1)) {
      EDGES.push(cps(c - 1), cps(c));
    }
  }
  const BASES = [0x23, 0x2a, 0x30, 0x31, 0x39, 0xa9, 0x2139, 0x2764, 0x2b07, 0x3030, 0x1f170, 0x1f321, 0x1f6f3];
  const QUIET = [0x231a, 0x261d, 0x2705, 0x270c, 0x26f9, 0x2b50, 0x1f004, 0x1f44d, 0x1f590, 0x1f6bc];
  const NOT_BASES = [0x41, 0x3d, 0x2192, 0x2605, 0x1f600, 0x1fae9, 0x20e3, 0xfe0f];
  const colour = () => cps(pick(QUIET));
  const selectorRun = () =>
    pick(["", VS16, VS16 + VS16, VS16 + VS16 + VS16, `${hidden()}${VS16}`, `${VS16}${hidden()}${VS16}`]);
  const emoji = () =>
    cps(pick(pick([BASES, QUIET, NOT_BASES]))) +
    pick(["", VS16, VS16 + VS16, VS16 + KEYCAP, KEYCAP, `${VS16}${hidden()}${KEYCAP}`, `${hidden()}${VS16}${KEYCAP}`]);
  const hidden = (): string =>
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
      () => pick(EDGES),
      () => pick([VS16, VS16, VS16 + KEYCAP]),
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
      emoji,
      emoji,
      () => secret() + emoji(),
      () => `${secret()}${pick(["", "1", "#"])}${VS16}${KEYCAP}`,
      // A colour emoji's quiet selector inside a secret, and right after one's last character.
      () => `${labelled()}${colour()}${selectorRun()}${pick(["", "ab", " ok"])}`,
      () => `${pick(LABELS)}: ab${colour()}${selectorRun()}cd${pick(["", colour() + VS16])}`,
      () => `x://u:${str(ALNUM, 1 + int(4))}${colour()}${selectorRun()}@h`,
      () => colour() + selectorRun(),
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
