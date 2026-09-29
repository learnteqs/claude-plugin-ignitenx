// Port of TM's spec text rules (normalize.go, secrets.go, evidence.go, freeText in rules.go). It must answer exactly as
// TM does, so where JavaScript regexes differ from RE2 the patterns spell out what RE2 does.

export const REDACTED = "[redacted]";

export interface Count {
  code: string;
  count: number;
}

const CONTROL = "control";
const BIDI_CONTROL = "bidi_control";
const ZERO_WIDTH = "zero_width";
const TAG_CHARACTER = "tag_character";
const VARIATION_SELECTOR = "variation_selector";
const HIDDEN_CLASSES = [CONTROL, BIDI_CONTROL, ZERO_WIDTH, TAG_CHARACTER, VARIATION_SELECTOR];

// TM's three tables are literal, as here, so that no runtime's Unicode version decides what is hidden.
// TM's hiddenRanges, sorted: every control but tab and LF and every format or default-ignorable character but VS16.
const HIDDEN_RANGES: [number, number, string][] = [
  [0x0000, 0x0008, CONTROL],
  [0x000b, 0x001f, CONTROL],
  [0x007f, 0x009f, CONTROL],
  [0x00ad, 0x00ad, ZERO_WIDTH],
  [0x034f, 0x034f, ZERO_WIDTH],
  [0x0600, 0x0605, ZERO_WIDTH],
  [0x061c, 0x061c, BIDI_CONTROL],
  [0x06dd, 0x06dd, ZERO_WIDTH],
  [0x070f, 0x070f, ZERO_WIDTH],
  [0x0890, 0x0891, ZERO_WIDTH],
  [0x08e2, 0x08e2, ZERO_WIDTH],
  [0x115f, 0x1160, ZERO_WIDTH],
  [0x17b4, 0x17b5, ZERO_WIDTH],
  [0x180b, 0x180d, VARIATION_SELECTOR],
  [0x180e, 0x180e, ZERO_WIDTH],
  [0x180f, 0x180f, VARIATION_SELECTOR],
  [0x200b, 0x200d, ZERO_WIDTH],
  [0x200e, 0x200f, BIDI_CONTROL],
  [0x202a, 0x202e, BIDI_CONTROL],
  [0x2060, 0x2065, ZERO_WIDTH],
  [0x2066, 0x2069, BIDI_CONTROL],
  [0x206a, 0x206f, ZERO_WIDTH],
  [0x3164, 0x3164, ZERO_WIDTH],
  [0xfe00, 0xfe0e, VARIATION_SELECTOR],
  [0xfeff, 0xfeff, ZERO_WIDTH],
  [0xffa0, 0xffa0, ZERO_WIDTH],
  [0xfff0, 0xfffb, ZERO_WIDTH],
  [0x110bd, 0x110bd, ZERO_WIDTH],
  [0x110cd, 0x110cd, ZERO_WIDTH],
  [0x13430, 0x1343f, ZERO_WIDTH],
  [0x1bca0, 0x1bca3, ZERO_WIDTH],
  [0x1d173, 0x1d17a, ZERO_WIDTH],
  [0xe0000, 0xe00ff, TAG_CHARACTER],
  [0xe0100, 0xe01ef, VARIATION_SELECTOR],
  [0xe01f0, 0xe0fff, TAG_CHARACTER],
];

// TM's emojiBases, sorted: they take VS16 in Unicode 16.0's emoji-variation-sequences.txt and draw as text by default,
// so VS16 visibly changes them.
// 210 code points in 117 ranges.
const EMOJI_BASES: [number, number][] = [
  [0x0023, 0x0023], [0x002a, 0x002a], [0x0030, 0x0039], [0x00a9, 0x00a9], [0x00ae, 0x00ae], [0x203c, 0x203c],
  [0x2049, 0x2049], [0x2122, 0x2122], [0x2139, 0x2139], [0x2194, 0x2199], [0x21a9, 0x21aa], [0x2328, 0x2328],
  [0x23cf, 0x23cf], [0x23ed, 0x23ef], [0x23f1, 0x23f2], [0x23f8, 0x23fa], [0x24c2, 0x24c2], [0x25aa, 0x25ab],
  [0x25b6, 0x25b6], [0x25c0, 0x25c0], [0x25fb, 0x25fc], [0x2600, 0x2604], [0x260e, 0x260e], [0x2611, 0x2611],
  [0x2618, 0x2618], [0x2620, 0x2620], [0x2622, 0x2623], [0x2626, 0x2626], [0x262a, 0x262a], [0x262e, 0x262f],
  [0x2638, 0x263a], [0x2640, 0x2640], [0x2642, 0x2642], [0x265f, 0x2660], [0x2663, 0x2663], [0x2665, 0x2666],
  [0x2668, 0x2668], [0x267b, 0x267b], [0x267e, 0x267e], [0x2692, 0x2692], [0x2694, 0x2697], [0x2699, 0x2699],
  [0x269b, 0x269c], [0x26a0, 0x26a0], [0x26a7, 0x26a7], [0x26b0, 0x26b1], [0x26c8, 0x26c8], [0x26cf, 0x26cf],
  [0x26d1, 0x26d1], [0x26d3, 0x26d3], [0x26e9, 0x26e9], [0x26f0, 0x26f1], [0x26f4, 0x26f4], [0x26f7, 0x26f8],
  [0x2702, 0x2702], [0x2708, 0x2709], [0x270f, 0x270f], [0x2712, 0x2712], [0x2714, 0x2714], [0x2716, 0x2716],
  [0x271d, 0x271d], [0x2721, 0x2721], [0x2733, 0x2734], [0x2744, 0x2744], [0x2747, 0x2747], [0x2763, 0x2764],
  [0x27a1, 0x27a1], [0x2934, 0x2935], [0x2b05, 0x2b07], [0x3030, 0x3030], [0x303d, 0x303d], [0x3297, 0x3297],
  [0x3299, 0x3299], [0x1f170, 0x1f171], [0x1f17e, 0x1f17f], [0x1f202, 0x1f202], [0x1f237, 0x1f237], [0x1f321, 0x1f321],
  [0x1f324, 0x1f32c], [0x1f336, 0x1f336], [0x1f37d, 0x1f37d], [0x1f396, 0x1f397], [0x1f399, 0x1f39b],
  [0x1f39e, 0x1f39f], [0x1f3cd, 0x1f3ce], [0x1f3d4, 0x1f3df], [0x1f3f3, 0x1f3f3], [0x1f3f5, 0x1f3f5],
  [0x1f3f7, 0x1f3f7], [0x1f43f, 0x1f43f], [0x1f441, 0x1f441], [0x1f4fd, 0x1f4fd], [0x1f549, 0x1f54a],
  [0x1f56f, 0x1f570], [0x1f573, 0x1f573], [0x1f576, 0x1f579], [0x1f587, 0x1f587], [0x1f58a, 0x1f58d],
  [0x1f5a5, 0x1f5a5], [0x1f5a8, 0x1f5a8], [0x1f5b1, 0x1f5b2], [0x1f5bc, 0x1f5bc], [0x1f5c2, 0x1f5c4],
  [0x1f5d1, 0x1f5d3], [0x1f5dc, 0x1f5de], [0x1f5e1, 0x1f5e1], [0x1f5e3, 0x1f5e3], [0x1f5e8, 0x1f5e8],
  [0x1f5ef, 0x1f5ef], [0x1f5f3, 0x1f5f3], [0x1f5fa, 0x1f5fa], [0x1f6cb, 0x1f6cb], [0x1f6cd, 0x1f6cf],
  [0x1f6e0, 0x1f6e5], [0x1f6e9, 0x1f6e9], [0x1f6f0, 0x1f6f0], [0x1f6f3, 0x1f6f3],
];

// TM's quietBases, sorted: they take VS16 in that file but draw in colour anyway (Emoji_Presentation or
// Emoji_Modifier_Base), so VS16 after one changes nothing and is removed without being counted.
// 161 code points in 88 ranges.
const QUIET_BASES: [number, number][] = [
  [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615],
  [0x261d, 0x261d], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
  [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3],
  [0x26f5, 0x26f5], [0x26f9, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270d], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x1f004, 0x1f004], [0x1f21a, 0x1f21a],
  [0x1f22f, 0x1f22f], [0x1f30d, 0x1f30f], [0x1f315, 0x1f315], [0x1f31c, 0x1f31c], [0x1f378, 0x1f378],
  [0x1f393, 0x1f393], [0x1f3a7, 0x1f3a7], [0x1f3ac, 0x1f3ae], [0x1f3c2, 0x1f3c2], [0x1f3c4, 0x1f3c4],
  [0x1f3c6, 0x1f3c6], [0x1f3ca, 0x1f3cc], [0x1f3e0, 0x1f3e0], [0x1f3ed, 0x1f3ed], [0x1f408, 0x1f408],
  [0x1f415, 0x1f415], [0x1f41f, 0x1f41f], [0x1f426, 0x1f426], [0x1f442, 0x1f442], [0x1f446, 0x1f449],
  [0x1f44d, 0x1f44e], [0x1f453, 0x1f453], [0x1f46a, 0x1f46a], [0x1f47d, 0x1f47d], [0x1f4a3, 0x1f4a3],
  [0x1f4b0, 0x1f4b0], [0x1f4b3, 0x1f4b3], [0x1f4bb, 0x1f4bb], [0x1f4bf, 0x1f4bf], [0x1f4cb, 0x1f4cb],
  [0x1f4da, 0x1f4da], [0x1f4df, 0x1f4df], [0x1f4e4, 0x1f4e6], [0x1f4ea, 0x1f4ed], [0x1f4f7, 0x1f4f7],
  [0x1f4f9, 0x1f4fb], [0x1f508, 0x1f508], [0x1f50d, 0x1f50d], [0x1f512, 0x1f513], [0x1f550, 0x1f567],
  [0x1f574, 0x1f575], [0x1f590, 0x1f590], [0x1f610, 0x1f610], [0x1f687, 0x1f687], [0x1f68d, 0x1f68d],
  [0x1f691, 0x1f691], [0x1f694, 0x1f694], [0x1f698, 0x1f698], [0x1f6ad, 0x1f6ad], [0x1f6b2, 0x1f6b2],
  [0x1f6b9, 0x1f6ba], [0x1f6bc, 0x1f6bc],
];

// rangeAt is the range of sorted, disjoint ranges that holds cp, found as TM's sort.Search finds it.
function rangeAt<T extends [number, number, ...unknown[]]>(ranges: T[], cp: number): T | undefined {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((ranges[mid] as T)[1] >= cp) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  const r = ranges[lo];
  return r !== undefined && r[0] <= cp ? r : undefined;
}

export function hiddenClass(cp: number): string {
  return rangeAt(HIDDEN_RANGES, cp)?.[2] ?? "";
}

const VS16 = 0xfe0f;
const KEYCAP = 0x20e3;
const emojiBase = (cp: number) => rangeAt(EMOJI_BASES, cp) !== undefined;
const quietBase = (cp: number) => rangeAt(QUIET_BASES, cp) !== undefined;
const keycapBase = (cp: number) => cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39);

// hiddenAt keeps VS16 only if prev (the last kept code point) is an emoji base and, for a keycap base, next (raw) is
// U+20E3. Every other code point is hidden by its class alone.
function hiddenAt(prev: number, cp: number, next: number): string {
  if (cp !== VS16) {
    return hiddenClass(cp);
  }
  return !emojiBase(prev) || (keycapBase(prev) && next !== KEYCAP) ? VARIATION_SELECTOR : "";
}

// What scan reports for a VS16 that normalizeText removes without counting.
const QUIET = "quiet";

// scan judges each code point of s in turn and calls visit with its UTF-16 offset, its length and its class, "" if
// kept; visit returns true to stop. Normalising, it judges as normalizeText does: a CR or CRLF is one kept LF (a next CR
// reads as the LF it becomes: only U+20E3 matters there), and the first VS16 after a quiet base is QUIET and becomes
// prev, so a second one is counted. Otherwise it judges as TM's freeText does: a CR is a control, and a VS16 after a
// quiet base is hidden, as that base is no emoji base.
function scan(s: string, normalizing: boolean, visit: (at: number, n: number, hidden: string) => boolean | void): void {
  let prev = -1;
  for (let i = 0; i < s.length; ) {
    let cp = s.codePointAt(i) ?? 0;
    let n = width(cp);
    if (normalizing && cp === 0x0d) {
      cp = 0x0a;
      n = s.charCodeAt(i + 1) === 0x0a ? 2 : 1;
    }
    const hidden =
      normalizing && cp === VS16 && quietBase(prev) ? QUIET : hiddenAt(prev, cp, s.codePointAt(i + n) ?? -1);
    if (hidden === "" || hidden === QUIET) {
      prev = cp;
    }
    if (visit(i, n, hidden) === true) {
      return;
    }
    i += n;
  }
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
  const raw = wellFormed(s);
  const counts = new Map<string, number>();
  let out = "";
  scan(raw, true, (at, n, hidden) => {
    if (hidden === "") {
      out += raw.charCodeAt(at) === 0x0d ? "\n" : raw.slice(at, at + n);
    } else if (hidden !== QUIET) {
      bump(counts, hidden);
    }
  });
  return { text: trimSpace(out), stripped: ordered(HIDDEN_CLASSES, counts) };
}

// containsHidden reports whether s holds a character TM's freeText calls hidden (a CR is a control there, and so is a
// VS16 after a colour emoji).
export function containsHidden(s: string): boolean {
  let found = false;
  scan(wellFormed(s), false, (_at, _n, hidden) => {
    found = hidden !== "";
    return found;
  });
  return found;
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

const COLON = `["']?[${WS}]*[:=]`;
const KEYWORD =
  `(?:${ci("password|passwd|secret")}|${ci("api")}[_ -]?${ci("key")}|(${ci("token")}))(${ci("s")}|\\(${ci("s")}\\))?`;
// A keyword right before its colon, as in "Password:" or "Tokens :"; pwd takes no words.
const BARE_LABEL = new RegExp(`(?:${KEYWORD}|${ci("pwd")})${COLON}`, "gu");
const KEYWORD_AT = new RegExp(KEYWORD, "gu");
// A label with words, as in "Password for the admin:", has up to 4 words of up to 64 code points.
const MAX_WORDS = 4;
const MAX_WORD_CODE_POINTS = 64;
// A metering word starting a word after "token" is about usage, as in "Token budget/month: 50000".
const METERING = new RegExp(
  `^[("'\\[]?(?:${ci("budget|limit|count|usage|used|cost|quota|price|pricing|rate|spend|consumption|allocation")}|` +
    `${ci("allowance|allotment|credit|volume|pack|cap|balance|remaining|utilisation|utilization|per|overage")})` +
    `${ci("s")}?(?:[^A-Za-z]|$)`,
  "u",
);
const NUMBER = new RegExp(
  `^["'(\\[]?~?(?:\\$|US\\$|\\u20ac|\\u00a3|\\u20b9|${ci("rs")}\\.?|${ci("inr|usd")})?` +
    `[0-9][0-9,.]*(?:${ci("k|m|lakh|crore")}|%)?(?:[-/][0-9][0-9,.]*(?:${ci("k|m")})?)?` +
    `(?:/-|\\+|/(?:${ci("month|mo|day|week|year|yr|annum|user|seat|learner")}))?["')\\]}]*[,;]?$`,
  "u",
);
// A plain word is prose, as in "Token budget: approved"; a token mixes case, digits or symbols.
const PLAIN_WORD = /^(?:[A-Z]?[a-z]{1,12}(?:-[a-z]{1,12})?|[A-Z]{2,9})[).,;:!\]}]{0,2}$/u;

export function isPlainWord(s: string): boolean {
  return PLAIN_WORD.test(s);
}
const ADDRESS = "[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)*[.][A-Za-z]{2,}";
const EMAILS = new RegExp(`^(?:${ci("mailto")}:)?${ADDRESS}(?:[;,/]${ADDRESS})*[.,;)]?$`, "u");
// What labels ending at one place keep: an email after words, and a plain word after usage or inside brackets.
type LabelEnd = { bare: boolean; worded: boolean; inner: boolean; usage: boolean; singular: boolean };

// labelValues finds the value after each label such as "Password:", "Password for the admin:" or DB_PASSWORD=: the
// next run of at least four non-space characters. A run that ends in a singular bare label is a blank field.
function labelValues(s: string): [number, number][] {
  const labels = new Map<number, LabelEnd>();
  const add = (end: number, l: LabelEnd) => {
    const seen = labels.get(end);
    labels.set(
      end,
      seen
        ? {
            bare: l.bare || seen.bare,
            worded: l.worded || seen.worded,
            inner: l.inner && seen.inner,
            usage: l.usage && seen.usage,
            singular: l.singular || seen.singular,
          }
        : l,
    );
  };
  eachMatch(s, BARE_LABEL, (m) => {
    const usage = m[1] !== undefined && m[2] !== undefined;
    add(m.index + m[0].length, { bare: true, worded: false, inner: false, usage, singular: m[2] === undefined });
  });
  eachMatch(s, KEYWORD_AT, (m) => {
    wordedEnds(s, m.index + m[0].length, m[1] !== undefined, (end, inner, metering) => {
      const usage = m[1] !== undefined && (m[2] !== undefined || metering);
      add(end, { bare: false, worded: true, inner, usage, singular: false });
    });
  });
  const out: [number, number][] = [];
  let end = 0;
  for (const [labelEnd, label] of [...labels].sort((a, b) => a[0] - b[0])) {
    let start = valueStart(s, labelEnd);
    const worded = label.worded && !label.bare;
    let list = false;
    if (worded) {
      let word: [number, number] | null;
      let blank: boolean;
      [start, word, blank, list] = pastKeys(s, labelEnd, start, labels);
      if (blank) {
        continue;
      }
      if (word && charCount(s.slice(...word)) >= 4) {
        out.push(word);
      }
    }
    // Linear for glued labels: values start in order, so one inside the previous run ends where it does, and any eight
    // code units hold at least four code points.
    end = start < end ? end : skip(s, start, false);
    const run = s.slice(start, end);
    const blank = labels.get(end)?.singular === true;
    const prose = PLAIN_WORD.test(run);
    const wordedKeeps = worded && (EMAILS.test(unwrapped(run)) || (label.inner && prose));
    const kept = wordedKeeps || (label.usage && (NUMBER.test(run) || prose));
    if (blank || kept) {
      continue;
    }
    const stop = valueEnd(s, start, end, labels);
    if (charCount(s.slice(start, Math.min(stop, start + 8))) >= 4) {
      out.push([start, stop]);
    }
    if (list) {
      listValues(s, stop, labels, out);
    }
  }
  return out;
}

// wordedEnds passes each colon before whitespace in MAX_WORDS words: inside brackets, then the first outside, the end.
function wordedEnds(s: string, i: number, token: boolean, found: Found): void {
  const open = s.codePointAt(i);
  if (open !== 0x28 && open !== 0x5b) {
    const next = skipH(s, i);
    if (next === i) {
      return;
    }
    i = next;
  }
  let depth = 0;
  let first = false;
  for (let word = 0; word < MAX_WORDS; word++) {
    const r0 = s.codePointAt(i) ?? 0;
    if (i >= s.length || spaceCode(r0) || r0 === 0x3d || (r0 === 0x3a && depth === 0)) {
      return;
    }
    let j = i;
    let n = 0;
    for (; j < s.length && n <= MAX_WORD_CODE_POINTS + 1; n++) {
      const r = s.codePointAt(j) ?? 0;
      const w = width(r);
      if (spaceCode(r) || r === 0x3d) {
        break;
      }
      if (r === 0x3a && j > i && startsSpace(s, j + w) && n <= MAX_WORD_CODE_POINTS) {
        found(j + w, depth > 0, token && (first || METERING.test(s.slice(i, j))));
        if (depth === 0) {
          return;
        }
      }
      if (r === 0x28 || r === 0x5b || r === 0x7b) {
        depth++;
      } else if (r === 0x29 || r === 0x5d || r === 0x7d) {
        depth = Math.max(depth - 1, 0);
      }
      j += w;
    }
    if (n > MAX_WORD_CODE_POINTS) {
      return;
    }
    const metering = token && METERING.test(s.slice(i, j));
    first = first || (word === 0 && metering);
    const k = skip(s, j, true);
    if ((s[k] === ":" || s[k] === "=") && startsSpace(s, k + 1)) {
      found(k + 1, depth > 0, first || metering);
      if (depth === 0) {
        return;
      }
    }
    i = skipH(s, j);
    if (i === j) {
      return;
    }
  }
}

// pastKeys skips keys after a worded label, as "Temp:" in "Password (admin): Temp: X", and the word of a two-word key.
function pastKeys(
  s: string,
  labelEnd: number,
  start: number,
  labels: Map<number, LabelEnd>,
): [number, [number, number] | null, boolean, boolean] {
  let word: [number, number] | null = null;
  let list = false;
  for (let n = 0; n < MAX_WORDS; n++) {
    const stop = skip(s, start, false);
    const next = skipH(s, stop);
    const lineEnds = next >= s.length || lineBreak(s.charCodeAt(next));
    if (stop === start) {
      return [start, word, false, list];
    }
    if (isKeyRun(s, start, stop, labels)) {
      // A key on a later line leaves the label blank; one that ends its line takes the next line's value.
      for (let k = labelEnd; k < start; k++) {
        if (lineBreak(s.charCodeAt(k))) {
          return [start, word, true, list];
        }
      }
      if (lineEnds) {
        const after = skip(s, next, true);
        if (after >= s.length) {
          return [start, word, false, list];
        }
        return [after, word, isKeyRun(s, after, skip(s, after, false), labels), false];
      }
      [start, list] = [next, true];
    } else if (
      word === null &&
      s.slice(stop, next) === " " &&
      LETTERS.test(s.slice(start, stop)) &&
      keyThenValue(s, next, labels)
    ) {
      [word, start] = [[start, stop], next];
    } else {
      return [start, word, false, list];
    }
  }
  return [start, word, false, list];
}

// keyThenValue is a key at i with a value after it on its line that is not a plain word, as in "Key: k3yPrimary99".
function keyThenValue(s: string, i: number, labels: Map<number, LabelEnd>): boolean {
  const stop = skip(s, i, false);
  const v = skipH(s, stop);
  const end = skip(s, v, false);
  return isKeyRun(s, i, stop, labels) && v > stop && end > v && !PLAIN_WORD.test(s.slice(v, end));
}

// listValues adds the values of the next keys on the line, as "trainer: Y" in "Passwords (LMS): admin: X trainer: Y".
function listValues(s: string, i: number, labels: Map<number, LabelEnd>, out: [number, number][]): void {
  for (let n = 0; n < MAX_WORDS; n++) {
    const key = skipH(s, i);
    const stop = skip(s, key, false);
    const v = skipH(s, stop);
    const end = skip(s, v, false);
    if (!isKeyRun(s, key, stop, labels) || v === stop || end === v) {
      return;
    }
    if (charCount(s.slice(v, Math.min(end, v + 8))) >= 4 && !PLAIN_WORD.test(s.slice(v, end))) {
      out.push([v, end]);
    }
    i = end;
  }
}

// isKeyRun is a run like "Temp:" or "(admin):" that names a field, and doesn't end a label of its own.
function isKeyRun(s: string, start: number, stop: number, labels: Map<number, LabelEnd>): boolean {
  return stop > start && s[stop - 1] === ":" && keyWord(s.slice(start, stop - 1)) && !labels.has(stop);
}

// keyWord is a field name: ASCII letters and "_./()-", with no digit or other symbol, as a password would have.
function keyWord(w: string): boolean {
  return /^[A-Za-z_./()-]+$/.test(w) && /[A-Za-z]/.test(w);
}

const LETTERS = /^[A-Za-z]+$/;

type Found = (end: number, inner: boolean, metering: boolean) => void;

function startsSpace(s: string, i: number): boolean {
  return i < s.length && spaceCode(s.codePointAt(i) ?? 0);
}

function skipH(s: string, i: number): number {
  while (i < s.length) {
    const cp = s.codePointAt(i) ?? 0;
    if (!spaceCode(cp) || lineBreak(cp)) {
      break;
    }
    i += width(cp);
  }
  return i;
}

// eachMatch passes found the match at every start, so a label inside another's words is found too.
function eachMatch(s: string, re: RegExp, found: (m: RegExpExecArray) => void): void {
  re.lastIndex = 0;
  // Every keyword starts with a BMP character (ASCII or U+017F), so index + 1 is never inside a surrogate pair.
  for (let m = re.exec(s); m; m = re.exec(s)) {
    found(m);
    re.lastIndex = m.index + 1;
  }
}

const asciiAlnum = (cp: number) =>
  (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a);
const lineBreak = (cp: number) => cp === 0x0a || cp === 0x2028 || cp === 0x2029;

function valueStart(s: string, i: number): number {
  i = skip(s, i, true);
  for (let n = 0; ; ) {
    const end = separatorEnd(s, i);
    const counted = end >= 0 && /[^>]/.test(s.slice(i, end));
    if (end < 0 || (counted && n === 2)) {
      return i;
    }
    if (counted) {
      n++;
    }
    i = skip(s, end, true);
  }
}

function separatorEnd(s: string, i: number): number {
  for (let n = 0; ; n++) {
    if (i >= s.length) {
      return n > 0 ? i : -1;
    }
    const cp = s.codePointAt(i) ?? 0;
    if (spaceCode(cp)) {
      return n > 0 ? i : -1;
    }
    if (n === 3 || asciiAlnum(cp)) {
      return -1;
    }
    i += width(cp);
  }
}

// valueEnd extends a quoted value to its closing quote, and a symbol-only value over the next runs up to a field.
function valueEnd(s: string, start: number, end: number, labels: Map<number, LabelEnd>): number {
  end = Math.max(end, quoteEnd(s, start));
  for (let from = start; !/[0-9A-Za-z]/.test(s.slice(from, end)); ) {
    const next = skipH(s, end);
    const stop = skip(s, next, false);
    // A mask is the whole value before a gap or a bracket, as in "Password : ********    Role : Admin".
    const masked = isMask(s.slice(from, end)) && ([...s.slice(end, next)].length > 1 || s[next] === "(");
    if (stop === next || labels.get(stop)?.singular || isKey(s, next, stop) || masked) {
      break;
    }
    [from, end] = [next, stop];
  }
  return end;
}

const MASK = new Set([0x2a, 0x2022, 0x25cf, 0x2217]);

// isMask is a run of at least four mask characters, as in "Password: ********".
function isMask(run: string): boolean {
  const chars = [...run];
  return chars.length >= 4 && chars.every((c) => MASK.has(c.codePointAt(0) ?? 0));
}

// isKey is a run that names the next field and has a value after it, as "Role:" or "Role" in "Role : Admin".
function isKey(s: string, start: number, stop: number): boolean {
  if (s[stop - 1] === ":") {
    return keyWord(s.slice(start, stop - 1)) && hasRun(s, skipH(s, stop));
  }
  const k = skipH(s, stop);
  return keyWord(s.slice(start, stop)) && (s[k] === ":" || s[k] === "=") && hasRun(s, skipH(s, k + 1));
}

function hasRun(s: string, i: number): boolean {
  return i < s.length && !spaceCode(s.codePointAt(i) ?? 0);
}

const QUOTES = new Map([
  [0x22, 0x22],
  [0x27, 0x27],
  [0x60, 0x60],
  [0x201c, 0x201d],
  [0x2018, 0x2019],
]);
const MAX_QUOTED = 64;
const WRAPPERS = new Map<number, number>([...QUOTES, [0x3c, 0x3e], [0x28, 0x29]]);

function quoteEnd(s: string, start: number): number {
  const closing = QUOTES.get(s.codePointAt(start) ?? -1);
  if (closing === undefined) {
    return start;
  }
  let i = start + 1;
  for (let n = 0; n < MAX_QUOTED && i < s.length; n++) {
    const cp = s.codePointAt(i) ?? 0;
    i += width(cp);
    if (lineBreak(cp)) {
      break;
    }
    if (cp === closing && !asciiAlnum(s.codePointAt(i) ?? -1)) {
      return i;
    }
  }
  return start;
}

// unwrapped is v without one layer of <>, () or quotes around it; every opener and closer is one code unit.
function unwrapped(v: string): string {
  const closing = WRAPPERS.get(v.codePointAt(0) ?? -1);
  return v.length > 1 && closing !== undefined && v.charCodeAt(v.length - 1) === closing ? v.slice(1, -1) : v;
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
  { code: "aws_access_key", find: pattern(/(?:^|[^0-9A-Z])((?:AKIA|ASIA)[0-9A-Z]{16,})/dgu, 1) },
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
      if (!isRedacted(s.slice(start, end))) {
        // A VS16 after a secret goes with it: after the token it would be a hidden character.
        spans.push({ start, end: s.charCodeAt(end) === VS16 ? end + 1 : end, priority, code: p.code });
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

// isRedacted is REDACTED with at most closing punctuation after it, as in `"password": [redacted],`.
function isRedacted(found: string): boolean {
  if (!found.startsWith(REDACTED)) {
    return false;
  }
  for (const c of found.slice(REDACTED.length)) {
    if (!CLOSING.has(c.codePointAt(0) ?? 0)) {
      return false;
    }
  }
  return true;
}

// , . ; : ! ? ) ] } " ' and the closing curly quotes and guillemet.
const CLOSING = new Set([0x2c, 0x2e, 0x3b, 0x3a, 0x21, 0x3f, 0x29, 0x5d, 0x7d, 0x22, 0x27, 0x201d, 0x2019, 0xbb]);

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

// redactedTexts returns the text of s behind each [redacted] that redact(s) writes, in order. A secret a later pass
// finds around an earlier token comes back whole, with what that token replaced.
export function redactedTexts(s: string): string[] {
  // Code unit i of text stands for s.slice(from[i], to[i]): itself, or all that its token replaced.
  let text = s;
  let from = Array.from({ length: s.length }, (_, i) => i);
  let to = from.map((i) => i + 1);
  const replaced: [number, number][] = [];
  for (let pass = 0; pass < MAX_REDACT_PASSES; pass++) {
    const spans = findSecrets(text);
    if (spans.length === 0) {
      break;
    }
    let out = "";
    const outFrom: number[] = [];
    const outTo: number[] = [];
    const copy = (start: number, end: number) => {
      out += text.slice(start, end);
      for (let k = start; k < end; k++) {
        outFrom.push(from[k] ?? 0);
        outTo.push(to[k] ?? 0);
      }
    };
    let last = 0;
    for (const sp of spans) {
      copy(last, sp.start);
      const range: [number, number] = [from[sp.start] ?? 0, to[sp.end - 1] ?? 0];
      replaced.push(range);
      out += REDACTED;
      for (let k = 0; k < REDACTED.length; k++) {
        outFrom.push(range[0]);
        outTo.push(range[1]);
      }
      last = sp.end;
    }
    copy(last, text.length);
    [text, from, to] = [out, outFrom, outTo];
  }
  replaced.sort((a, b) => a[0] - b[0]);
  const outer: [number, number][] = [];
  for (const [start, end] of replaced) {
    const prev = outer.at(-1);
    if (prev && start < prev[1]) {
      prev[1] = Math.max(prev[1], end);
    } else {
      outer.push([start, end]);
    }
  }
  return outer.map(([start, end]) => s.slice(start, end));
}

const COUNTED = 1;
const QUIETLY = 2;

// mapNormalized is normalizeText's text for well-formed raw, with the raw range [from, to) of each of its code units,
// and a mark on each raw code unit normalizeText removes: COUNTED, or QUIETLY for a VS16 it removes without counting.
function mapNormalized(raw: string): { text: string; from: number[]; to: number[]; removed: Uint8Array } {
  let text = "";
  const from: number[] = [];
  const to: number[] = [];
  const removed = new Uint8Array(raw.length);
  scan(raw, true, (at, n, hidden) => {
    if (hidden !== "") {
      removed.fill(hidden === QUIET ? QUIETLY : COUNTED, at, at + n);
    } else if (raw.charCodeAt(at) === 0x0d) {
      text += "\n";
      from.push(at);
      to.push(at + n);
    } else {
      text += raw.slice(at, at + n);
      for (let k = at; k < at + n; k++) {
        from.push(k);
        to.push(k + 1);
      }
    }
  });
  const [start, end] = trimBounds(text);
  return { text: text.slice(start, end), from: from.slice(start, end), to: to.slice(start, end), removed };
}

// redactRaw replaces in raw itself the secrets redact finds in normalizeText(raw). A replaced range keeps the characters
// normalizeText removed from it and counted, after the token, where each is still removed (a VS16 after "]" is), so
// normalising the result strips and counts the same characters and gives redact's text. A VS16 a secret took is not
// one of them: it was kept, and goes with the secret. Nor is a VS16 removed quietly after a colour emoji, which after
// the token would be counted: it goes with the secret too, also the one after the secret's last character.
export function redactRaw(raw: string): { text: string; redactions: Count[] } {
  raw = wellFormed(raw);
  const counts = new Map<string, number>();
  for (let pass = 0; pass < MAX_REDACT_PASSES; pass++) {
    const { text, from, to, removed } = mapNormalized(raw);
    const spans = findSecrets(text);
    if (spans.length === 0) {
      break;
    }
    let out = "";
    let last = 0;
    for (const sp of spans) {
      const start = from[sp.start] ?? raw.length;
      let end = to[sp.end - 1] ?? start;
      let next = end;
      while (removed[next] === COUNTED) {
        next++;
      }
      if (removed[next] === QUIETLY) {
        end = next + 1;
      }
      out += raw.slice(last, start) + REDACTED;
      for (let k = start; k < end; k++) {
        out += removed[k] === COUNTED ? raw[k] : "";
      }
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
  let free = true;
  scan(s, false, (at, n, hidden) => {
    const ch = s.slice(at, at + n);
    free = hidden === "" && PRINTABLE.test(ch) && ch !== "<" && ch !== ">" && ch !== "`";
    return !free;
  });
  return free && !LINK.test(s);
}

export function textCode(s: string, maxChars: number): "" | "length" | "free_text" {
  const n = charCount(s);
  if (n < 1 || n > maxChars) {
    return "length";
  }
  return isFreeText(s) ? "" : "free_text";
}
