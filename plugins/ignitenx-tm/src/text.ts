// Port of TM's spec text rules (normalize.go, secrets.go, evidence.go, freeText in rules.go). It must answer exactly as
// TM does, so where JavaScript regexes differ from RE2 the patterns spell out what RE2 does.

export const REDACTED = "[redacted]";

export interface Count {
  code: string;
  count: number;
}

const HIDDEN_CLASSES = ["control", "bidi_control", "zero_width", "tag_character", "variation_selector"];

export function hiddenClass(cp: number): string {
  if (cp === 0x09 || cp === 0x0a) {
    return "";
  }
  if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) {
    return "control";
  }
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x200e || cp === 0x200f || cp === 0x061c) {
    return "bidi_control";
  }
  if ((cp >= 0x200b && cp <= 0x200d) || (cp >= 0x2060 && cp <= 0x2064) || cp === 0xfeff || cp === 0x00ad || cp === 0x180e) {
    return "zero_width";
  }
  if (cp >= 0xe0000 && cp <= 0xe007f) {
    return "tag_character";
  }
  if (cp >= 0xe0100 && cp <= 0xe01ef) {
    return "variation_selector";
  }
  return "";
}

// Every space is in the BMP, so code units can be tested directly.
function spaceCode(cp: number): boolean {
  switch (cp) {
    case 0x09:
    case 0x0a:
    case 0x20:
    case 0xa0:
    case 0x1680:
    case 0x2028:
    case 0x2029:
    case 0x202f:
    case 0x205f:
    case 0x3000:
      return true;
  }
  return cp >= 0x2000 && cp <= 0x200a;
}

export function isSpace(ch: string): boolean {
  const cp = ch.codePointAt(0);
  return cp !== undefined && spaceCode(cp);
}

function trimBounds(s: string): [number, number] {
  let start = 0;
  let end = s.length;
  while (start < end && spaceCode(s.charCodeAt(start))) {
    start++;
  }
  while (end > start && spaceCode(s.charCodeAt(end - 1))) {
    end--;
  }
  return [start, end];
}

export function trimSpace(s: string): string {
  return s.slice(...trimBounds(s));
}

const width = (cp: number) => (cp > 0xffff ? 2 : 1);

export function charCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; n++) {
    i += width(s.codePointAt(i) ?? 0);
  }
  return n;
}

// String.prototype.toWellFormed: a lone surrogate reaches TM through JSON as U+FFFD.
const wellFormed = (s: string) => s.replace(/\p{Cs}/gu, "\ufffd");

function ordered(order: readonly string[], counts: Map<string, number>): Count[] {
  return order.flatMap((code) => {
    const count = counts.get(code) ?? 0;
    return count > 0 ? [{ code, count }] : [];
  });
}

function bump(counts: Map<string, number>, code: string): void {
  counts.set(code, (counts.get(code) ?? 0) + 1);
}

export function normalizeText(s: string): { text: string; stripped: Count[] } {
  const counts = new Map<string, number>();
  let out = "";
  for (const ch of wellFormed(s).replaceAll("\r\n", "\n").replaceAll("\r", "\n")) {
    const c = hiddenClass(ch.codePointAt(0) ?? 0);
    if (c !== "") {
      bump(counts, c);
      continue;
    }
    out += ch;
  }
  return { text: trimSpace(out), stripped: ordered(HIDDEN_CLASSES, counts) };
}

const WS = "\\t\\n \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

// RE2's (?i) folds k with U+212A and s with U+017F. JavaScript's i flag does too, but then also treats those two as word
// characters for \b, which RE2 does not; so case-insensitive parts are spelled out and no pattern uses the i flag.
const FOLDS: Record<string, string> = { k: "\\u212a", s: "\\u017f" };
const ci = (word: string) =>
  word.replace(/[a-z]/gi, (c) => {
    const l = c.toLowerCase();
    return `[${l}${l.toUpperCase()}${FOLDS[l] ?? ""}]`;
  });
const LETTER = "a-zA-Z\\u017f\\u212a";

// RE2 runs in linear time and JavaScript backtracks. The lookbehinds on the scheme and the JWT only skip a start inside
// a run that an earlier start in the same run already covers, which keeps long runs linear without changing any match.
const SCHEME = `(?<![${LETTER}][${LETTER}0-9+.-]*?)[${LETTER}][${LETTER}0-9+.-]*://`;

type Finder = (s: string) => [number, number][];

function pattern(re: RegExp, group = 0): Finder {
  return (s) => {
    const out: [number, number][] = [];
    for (const m of s.matchAll(re)) {
      const at = m.indices?.[group];
      if (at) {
        out.push(at);
      }
    }
    return out;
  };
}

const LABEL = new RegExp(
  `(?:${ci("password|passwd|pwd|secret")}|${ci("api")}[_ -]?${ci("key")}|${ci("token")})["']?[${WS}]*[:=]`,
  "gu",
);

// labelValues finds the value after each label such as "Password:" or DB_PASSWORD=: the next run of at least four
// non-space characters. A run that ends in a label of its own is a blank field, not a value.
function labelValues(s: string): [number, number][] {
  const labelEnds = [...s.matchAll(LABEL)].map((m) => m.index + m[0].length);
  const ends = new Set(labelEnds);
  const out: [number, number][] = [];
  let end = 0;
  for (const labelEnd of labelEnds) {
    const start = skip(s, labelEnd, true);
    // Linear for glued labels: values start in order, so one inside the previous run ends where it does, and any eight
    // code units hold at least four code points.
    end = start < end ? end : skip(s, start, false);
    if (ends.has(end) || charCount(s.slice(start, Math.min(end, start + 8))) < 4) {
      continue;
    }
    out.push([start, end]);
  }
  return out;
}

function skip(s: string, i: number, space: boolean): number {
  while (i < s.length) {
    const cp = s.codePointAt(i) ?? 0;
    if (spaceCode(cp) !== space) {
      break;
    }
    i += width(cp);
  }
  return i;
}

// In priority order for naming overlapping matches.
const SECRET_PATTERNS: { code: string; find: Finder }[] = [
  {
    code: "private_key",
    find: pattern(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/dgu),
  },
  { code: "tm_agent_key", find: pattern(/tmk_[0-9a-f]{16}_[A-Za-z0-9_-]{43}/dgu) },
  {
    code: "lms_api_key",
    find: pattern(
      /inx_[A-Za-z0-9-]+_[A-Za-z0-9-]+_[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/dgu,
    ),
  },
  {
    code: "jwt",
    find: pattern(/eyJ(?<!eyJ[A-Za-z0-9_-]*?eyJ)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/dgu),
  },
  { code: "url_credentials", find: pattern(new RegExp(`${SCHEME}[^${WS}/:@]+:([^${WS}/@]+)@`, "dgu"), 1) },
  { code: "azure_account_key", find: pattern(new RegExp(`${ci("AccountKey")}=([^;${WS}]+)`, "dgu"), 1) },
  { code: "azure_sas", find: pattern(new RegExp(`${ci("SharedAccessSignature")}=([^;${WS}]+)`, "dgu"), 1) },
  { code: "azure_sas", find: pattern(/[?&]sig=([A-Za-z0-9_%/+=]{16,})/dgu, 1) },
  { code: "anthropic_key", find: pattern(/\bsk-ant-[A-Za-z0-9_-]{20,}/dgu) },
  { code: "openai_key", find: pattern(/\bsk-[A-Za-z0-9_-]{20,}/dgu) },
  { code: "aws_access_key", find: pattern(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/dgu) },
  { code: "github_token", find: pattern(/\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/dgu) },
  { code: "password_line", find: labelValues },
];

const SECRET_KINDS = [...new Set(SECRET_PATTERNS.map((p) => p.code))];

interface Span {
  start: number;
  end: number;
  priority: number;
  code: string;
}

function findSecrets(s: string): Span[] {
  const spans: Span[] = [];
  SECRET_PATTERNS.forEach((p, priority) => {
    for (const [start, end] of p.find(s)) {
      if (s.slice(start, end) !== REDACTED) {
        spans.push({ start, end, priority, code: p.code });
      }
    }
  });
  spans.sort((a, b) => a.start - b.start || a.priority - b.priority);
  const merged: Span[] = [];
  for (const sp of spans) {
    const last = merged.at(-1);
    if (last && sp.start < last.end) {
      last.end = Math.max(last.end, sp.end);
      continue;
    }
    merged.push(sp);
  }
  return merged;
}

export function containsSecret(s: string): boolean {
  return findSecrets(s).length > 0;
}

// A redaction can create the word boundary a following secret needs, as in a fixed-length key glued to "token:".
const MAX_REDACT_PASSES = 4;

export function redact(s: string): { text: string; redactions: Count[] } {
  const counts = new Map<string, number>();
  for (let pass = 0; pass < MAX_REDACT_PASSES; pass++) {
    const spans = findSecrets(s);
    if (spans.length === 0) {
      break;
    }
    let out = "";
    let last = 0;
    for (const sp of spans) {
      out += s.slice(last, sp.start) + REDACTED;
      last = sp.end;
      bump(counts, sp.code);
    }
    s = out + s.slice(last);
  }
  return { text: s, redactions: ordered(SECRET_KINDS, counts) };
}

// mapNormalized is normalizeText's text for well-formed raw, with the raw range [from, to) of each of its code units.
function mapNormalized(raw: string): { text: string; from: number[]; to: number[] } {
  let text = "";
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < raw.length; ) {
    const cp = raw.codePointAt(i) ?? 0;
    if (cp === 0x0d) {
      const n = raw.charCodeAt(i + 1) === 0x0a ? 2 : 1;
      text += "\n";
      from.push(i);
      to.push(i + n);
      i += n;
      continue;
    }
    const n = width(cp);
    if (hiddenClass(cp) === "") {
      text += raw.slice(i, i + n);
      for (let k = i; k < i + n; k++) {
        from.push(k);
        to.push(k + 1);
      }
    }
    i += n;
  }
  const [start, end] = trimBounds(text);
  return { text: text.slice(start, end), from: from.slice(start, end), to: to.slice(start, end) };
}

// A CR is never hidden: normalizeText turns it into LF first.
const hiddenIn = (s: string) =>
  [...s].filter((ch) => ch !== "\r" && hiddenClass(ch.codePointAt(0) ?? 0) !== "").join("");

// redactRaw replaces in raw itself the secrets redact finds in normalizeText(raw). A replaced range keeps the hidden
// characters it held, after the token, so normalising the result strips and counts the same characters and gives
// redact's text.
export function redactRaw(raw: string): { text: string; redactions: Count[] } {
  raw = wellFormed(raw);
  const counts = new Map<string, number>();
  for (let pass = 0; pass < MAX_REDACT_PASSES; pass++) {
    const { text, from, to } = mapNormalized(raw);
    const spans = findSecrets(text);
    if (spans.length === 0) {
      break;
    }
    let out = "";
    let last = 0;
    for (const sp of spans) {
      const start = from[sp.start] ?? raw.length;
      const end = to[sp.end - 1] ?? start;
      out += raw.slice(last, start) + REDACTED + hiddenIn(raw.slice(start, end));
      last = end;
      bump(counts, sp.code);
    }
    raw = out + raw.slice(last);
  }
  return { text: raw, redactions: ordered(SECRET_KINDS, counts) };
}

// collapse turns each whitespace run into one space and records each kept character's code-point offset in text.
function collapse(text: string): { collapsed: string; offsets: number[] } {
  let collapsed = "";
  const offsets: number[] = [];
  let inSpace = false;
  let i = 0;
  for (const ch of text) {
    if (!spaceCode(ch.codePointAt(0) ?? 0)) {
      collapsed += ch;
      offsets.push(i);
      inSpace = false;
    } else if (!inSpace) {
      collapsed += " ";
      offsets.push(i);
      inSpace = true;
    }
    i++;
  }
  return { collapsed, offsets };
}

// findQuote finds quote in text case-sensitively, with whitespace runs equal, as code-point offsets [start, end).
export function findQuote(text: string, quote: string): { start: number; end: number } | null {
  const needle = collapse(trimSpace(wellFormed(quote))).collapsed;
  if (needle === "") {
    return null;
  }
  const { collapsed, offsets } = collapse(wellFormed(text));
  const at = collapsed.indexOf(needle);
  if (at < 0) {
    return null;
  }
  const first = charCount(collapsed.slice(0, at));
  const start = offsets[first];
  const last = offsets[first + charCount(needle) - 1];
  return start === undefined || last === undefined ? null : { start, end: last + 1 };
}

const LINK = new RegExp(
  `\\b(?:${ci("https?|ftps?|wss?|javascript|vbscript|data|file|mailto|tel|sms|ssh|msteams")}):|${SCHEME}|` +
    `(?:^|[${WS}])//|\\b[${LETTER}0-9-]+(?:\\.[${LETTER}0-9-]+)*\\.[${LETTER}]{2,}/|${ci("www")}\\.|\\]\\(`,
  "u",
);

// Go's unicode.IsPrint: categories L, M, N, P and S, plus the ASCII space.
const PRINTABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]$/u;

export function isFreeText(s: string): boolean {
  s = wellFormed(s);
  if (s !== trimSpace(s)) {
    return false;
  }
  for (const ch of s) {
    if (hiddenClass(ch.codePointAt(0) ?? 0) !== "" || !PRINTABLE.test(ch) || ch === "<" || ch === ">" || ch === "`") {
      return false;
    }
  }
  return !LINK.test(s);
}

export function textCode(s: string, maxChars: number): "" | "length" | "free_text" {
  const n = charCount(s);
  if (n < 1 || n > maxChars) {
    return "length";
  }
  return isFreeText(s) ? "" : "free_text";
}
