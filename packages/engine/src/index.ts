export * from "./structures.ts";
export * from "./algorithms.ts";
import type {
  Document,
  Settings,
  Result,
  Match,
  Exclusion,
  Edge,
  Trace,
} from "@integrity/shared";
import {
  kmp,
  ahoCorasick,
  lcs,
  editDistance,
  rabinKarp,
  zAlgorithm,
  components,
  dijkstra,
  maxFlow,
} from "./algorithms.ts";
import { HashSet, AVLTree, BTree } from "./structures.ts";
export interface Token {
  word: string;
  start: number;
  end: number;
}
export function lower(s: string) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += String.fromCharCode(c >= 65 && c <= 90 ? c + 32 : c);
  }
  return out;
}
function wordChar(c: number) {
  return (
    (c >= 48 && c <= 57) ||
    (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) ||
    c >= 192
  );
}
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && wordChar(text.charCodeAt(i))) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      let word = "";
      for (let j = start; j < i; j++) word += text[j];
      out[out.length] = { word: lower(word), start, end: i };
      start = -1;
    }
  }
  return out;
}
export function words(text: string) {
  const tokens = tokenize(text),
    out: string[] = [];
  for (let i = 0; i < tokens.length; i++) out[i] = tokens[i].word;
  return out;
}
function part(s: string, start: number, end: number) {
  let out = "";
  for (let i = start; i < end; i++) out += s[i];
  return out;
}
function join(tokens: Token[], start = 0, end = tokens.length) {
  let out = "";
  for (let i = start; i < end; i++) {
    if (i > start) out += " ";
    out += tokens[i].word;
  }
  return out;
}
export function exclusions(text: string, templates: string[]): Exclusion[] {
  const out: Exclusion[] = [];
  let open = -1,
    close = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (open < 0 && (c === 34 || c === 8220)) {
      open = i;
      close = c === 34 ? 34 : 8221;
    } else if (open >= 0 && c === close) {
      if (i - open >= 12)
        out[out.length] = { start: open, end: i + 1, reason: "quotation" };
      open = -1;
    }
  }
  const tokens = tokenize(text);
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].word === "references" || tokens[i].word === "bibliography") {
      const p = tokens[i].start;
      let lineStart = true;
      for (let j = p - 1; j >= 0 && text.charCodeAt(j) !== 10; j--)
        if (text.charCodeAt(j) !== 32 && text.charCodeAt(j) !== 13)
          lineStart = false;
      let lineEnd = true;
      for (
        let j = tokens[i].end;
        j < text.length && text.charCodeAt(j) !== 10;
        j++
      )
        if (
          text.charCodeAt(j) !== 32 &&
          text.charCodeAt(j) !== 13 &&
          text.charCodeAt(j) !== 58
        )
          lineEnd = false;
      if (lineStart && lineEnd) {
        out[out.length] = { start: p, end: text.length, reason: "references" };
        break;
      }
    }
  }
  const hits = ahoCorasick(lower(text), templates);
  for (let i = 0; i < hits.length; i++)
    out[out.length] = {
      start: hits[i].start,
      end: hits[i].end,
      reason: "template",
    };
  return out;
}
function enabled(e: Exclusion, s: Settings) {
  return e.reason === "quotation"
    ? s.discountQuotes
    : e.reason === "references"
      ? s.discountReferences
      : s.discountTemplates;
}
function reasons(a: number, b: number, ex: Exclusion[], settings: Settings) {
  const out: string[] = [];
  for (let i = 0; i < ex.length; i++)
    if (a < ex[i].end && b > ex[i].start && enabled(ex[i], settings))
      out[out.length] = ex[i].reason;
  return out;
}
interface Passage {
  start: number;
  end: number;
  tokens: Token[];
}
function passages(text: string) {
  const out: Passage[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const c = text.charCodeAt(i);
    if (
      i === text.length ||
      c === 46 ||
      c === 33 ||
      c === 63 ||
      c === 10 ||
      i - start >= 650
    ) {
      const tokens = tokenize(part(text, start, Math.min(i + 1, text.length)));
      for (let j = 0; j < tokens.length; j++) {
        tokens[j].start += start;
        tokens[j].end += start;
      }
      if (tokens.length >= 5)
        out[out.length] = {
          start: tokens[0].start,
          end: tokens[tokens.length - 1].end,
          tokens,
        };
      start = i + 1;
    }
  }
  return out;
}
export function shingleSimilarity(a: Token[], b: Token[], size = 3) {
  const left = new HashSet(),
    right = new HashSet();
  let la = 0,
    lb = 0,
    common = 0;
  for (let i = 0; i <= a.length - size; i++) {
    const key = join(a, i, i + size);
    if (!left.has(key)) {
      left.add(key);
      la++;
    }
  }
  for (let i = 0; i <= b.length - size; i++) {
    const key = join(b, i, i + size);
    if (!right.has(key)) {
      right.add(key);
      lb++;
      if (left.has(key)) common++;
    }
  }
  return la + lb - common ? common / (la + lb - common) : 0;
}
export function analyzePair(
  a: Document,
  b: Document,
  templates: string[],
  settings: Settings,
): Result {
  const at = tokenize(a.text),
    bt = tokenize(b.text),
    ap = passages(a.text),
    bp = passages(b.text),
    ea = exclusions(a.text, templates),
    eb = exclusions(b.text, templates);
  const matches: Match[] = [];
  let truncated = false;
  const normalized = join(bt);
  const starts: number[] = [],
    ends: number[] = [];
  for (let i = 0; i < bt.length; i++) {
    if (i) {
      starts[starts.length] = bt[i].start;
      ends[ends.length] = bt[i].start;
    }
    for (let j = 0; j < bt[i].word.length; j++) {
      starts[starts.length] = bt[i].start;
      ends[ends.length] = bt[i].end;
    }
  }
  const add = (
    kind: Match["kind"],
    p: Passage,
    bs: number,
    be: number,
    similarity: number,
  ) => {
    if (matches.length >= 80) {
      truncated = true;
      return;
    }
    const ra = reasons(p.start, p.end, ea, settings),
      rb = reasons(bs, be, eb, settings);
    for (let j = 0; j < rb.length; j++) ra[ra.length] = rb[j];
    matches[matches.length] = {
      id: a.id + "~" + b.id + "~" + matches.length,
      kind,
      aStart: p.start,
      aEnd: p.end,
      bStart: bs,
      bEnd: be,
      similarity,
      excluded: ra.length > 0,
      reasons: ra,
    };
  };
  for (let i = 0; i < ap.length && i < 60; i++) {
    const p = ap[i],
      needle = join(p.tokens);
    const hits = kmp(normalized, needle);
    let exact = false;
    for (let h = 0; h < hits.length; h++) {
      const start = hits[h],
        end = start + needle.length;
      if (
        (start === 0 || normalized.charCodeAt(start - 1) === 32) &&
        (end === normalized.length || normalized.charCodeAt(end) === 32)
      ) {
        add("exact", p, starts[start], ends[end - 1], 1);
        exact = true;
      }
    }
    if (exact) continue;
    let best = 0,
      bestIndex = -1,
      bestShingle = 0;
    for (let j = 0; j < bp.length && j < 60; j++) {
      const q = bp[j];
      if (p.tokens.length > 128 || q.tokens.length > 128) {
        truncated = true;
        continue;
      }
      const pa: string[] = [],
        qb: string[] = [];
      for (let k = 0; k < p.tokens.length; k++) pa[k] = p.tokens[k].word;
      for (let k = 0; k < q.tokens.length; k++) qb[k] = q.tokens[k].word;
      const shared = lcs(pa, qb).length;
      const similarity = (2 * shared) / (pa.length + qb.length);
      if (similarity > best) {
        best = similarity;
        bestIndex = j;
        bestShingle = shingleSimilarity(p.tokens, q.tokens);
      }
    }
    if (bestIndex >= 0 && best >= 0.5) {
      const q = bp[bestIndex];
      add(bestShingle >= 0.24 ? "shingle" : "fuzzy", p, q.start, q.end, best);
    }
  }
  if (ap.length > 60 || bp.length > 60) truncated = true;
  const coverage = (tokens: Token[], side: "a" | "b", kind: Match["kind"]) => {
    let value = 0;
    for (let i = 0; i < tokens.length; i++) {
      let best = 0;
      for (let j = 0; j < matches.length; j++) {
        const m = matches[j],
          start = side === "a" ? m.aStart : m.bStart,
          end = side === "a" ? m.aEnd : m.bEnd;
        if (
          !m.excluded &&
          m.kind === kind &&
          tokens[i].start >= start &&
          tokens[i].end <= end
        )
          best = Math.max(best, m.similarity);
      }
      value += best;
    }
    return tokens.length ? (100 * value) / tokens.length : 0;
  };
  const comp = {
    exact: (coverage(at, "a", "exact") + coverage(bt, "b", "exact")) / 2,
    shingle: (coverage(at, "a", "shingle") + coverage(bt, "b", "shingle")) / 2,
    fuzzy: (coverage(at, "a", "fuzzy") + coverage(bt, "b", "fuzzy")) / 2,
  };
  const w = settings.weights,
    total = w.exact + w.shingle + w.fuzzy;
  return {
    id: a.id + "~" + b.id,
    a: a.id,
    b: b.id,
    score: total
      ? (comp.exact * w.exact +
          comp.shingle * w.shingle +
          comp.fuzzy * w.fuzzy) /
        total
      : 0,
    components: comp,
    matches,
    exclusionsA: ea,
    exclusionsB: eb,
    truncated,
  };
}
export function templatePatterns(documents: Document[]) {
  const out: string[] = [];
  for (let i = 0; i < documents.length; i++)
    if (documents[i].kind === "template") {
      const ps = passages(documents[i].text);
      for (let j = 0; j < ps.length; j++)
        out[out.length] = lower(
          part(documents[i].text, ps[j].start, ps[j].end),
        );
    }
  return out;
}
export function pairs(documents: Document[]) {
  const out: [number, number][] = [];
  for (let i = 0; i < documents.length; i++)
    for (let j = i + 1; j < documents.length; j++)
      if (
        documents[i].kind !== "template" &&
        documents[j].kind !== "template" &&
        (documents[i].kind === "submission" ||
          documents[j].kind === "submission")
      )
        out[out.length] = documents[i].kind === "submission" ? [i, j] : [j, i];
  return out;
}
export function rankResults(results: Result[], query = "", ascending = false) {
  const out: Result[] = [];
  for (let i = 0; i < results.length; i++)
    if (
      !query ||
      kmp(lower(results[i].a + " " + results[i].b), lower(query)).length
    )
      out[out.length] = results[i];
  for (let i = 1; i < out.length; i++) {
    const v = out[i];
    let j = i - 1;
    while (
      j >= 0 &&
      (ascending ? out[j].score > v.score : out[j].score < v.score)
    ) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = v;
  }
  return out;
}
export function resultGraph(
  documents: Document[],
  results: Result[],
  threshold: number,
) {
  const edges: Edge[] = [];
  for (let i = 0; i < results.length; i++)
    if (results[i].score >= threshold && results[i].score > 0) {
      let a = -1,
        b = -1;
      for (let j = 0; j < documents.length; j++) {
        if (documents[j].id === results[i].a) a = j;
        if (documents[j].id === results[i].b) b = j;
      }
      if (a >= 0 && b >= 0)
        edges[edges.length] = {
          from: a,
          to: b,
          weight: 101 - results[i].score,
        };
    }
  return edges;
}
function numericTokens(input: string): Token[] {
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (!((c >= 48 && c <= 57) || c === 32 || c === 9 || c === 10 || c === 13))
      throw new Error(
        "Enter only nonnegative integers separated by whitespace.",
      );
  }
  return tokenize(input);
}
export function runLab(algorithm: string, input: string, pattern: string) {
  const trace: Trace[] = [];
  let output = "";
  if (input.length > 160 || pattern.length > 80)
    throw new Error("Lab input limit: 160 characters; pattern: 80.");
  if (algorithm === "KMP") output = "Matches: " + kmp(input, pattern, trace);
  else if (algorithm === "Rabin–Karp")
    output = "Matches: " + rabinKarp(input, pattern, trace);
  else if (algorithm === "Z-algorithm")
    output = "Z values: " + zAlgorithm(input, trace);
  else if (algorithm === "Aho–Corasick") {
    const patterns: string[] = [];
    let p = "";
    for (let i = 0; i <= pattern.length; i++) {
      if (i === pattern.length || pattern.charCodeAt(i) === 44) {
        if (p) patterns[patterns.length] = p;
        p = "";
      } else p += pattern[i];
    }
    output = "Matches: " + ahoCorasick(input, patterns, trace).length;
  } else if (algorithm === "LCS")
    output =
      "Shared tokens: " + lcs(words(input), words(pattern), trace).length;
  else if (algorithm === "Edit distance")
    output = "Edits: " + editDistance(words(input), words(pattern), trace);
  else if (algorithm === "AVL rotations" || algorithm === "B-tree splits") {
    const ts = numericTokens(input);
    const tree =
      algorithm === "AVL rotations" ? new AVLTree(trace) : new BTree(trace);
    for (let i = 0; i < ts.length; i++) {
      const n = Number(ts[i].word);
      if (!Number.isFinite(n))
        throw new Error("Enter space-separated positive integers.");
      tree.insert(n);
    }
    output = "Inserted " + ts.length + " keys.";
  } else {
    const ts = numericTokens(input),
      edges: Edge[] = [];
    if (ts.length % 3 !== 0)
      throw new Error("Enter edge triples: from to weight. Nodes must be 0–7.");
    for (let i = 0; i < ts.length; i += 3) {
      const from = Number(ts[i].word),
        to = Number(ts[i + 1].word),
        weight = Number(ts[i + 2].word);
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        from > 7 ||
        to < 0 ||
        to > 7 ||
        !Number.isFinite(weight) ||
        weight < 0
      )
        throw new Error("Invalid edge triple.");
      edges[edges.length] = { from, to, weight };
    }
    if (algorithm === "Union-find")
      output = "Components: " + components(8, edges, trace).length;
    else if (algorithm === "Dijkstra") {
      const r = dijkstra(8, edges, 0, 3, trace);
      output = "0 → 3 distance: " + r.distance + "; path: " + r.path;
    } else output = "Flow 0 → 3: " + maxFlow(8, edges, 0, 3, trace);
  }
  if (!trace.length)
    trace[0] = {
      label: "Complete",
      values: [],
      active: [],
      detail: "No intermediate operations for this input.",
    };
  return { trace, output };
}
