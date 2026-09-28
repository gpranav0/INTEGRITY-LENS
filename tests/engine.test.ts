import { describe, it, expect } from "vitest";
import {
  kmp,
  rabinKarp,
  zAlgorithm,
  ahoCorasick,
  lcs,
  editDistance,
  exclusions,
  analyzePair,
  templatePatterns,
  pairs,
  rankResults,
  resultGraph,
  components,
  minimumSpanningForest,
  dijkstra,
  maxFlow,
  seededRandom,
  DynamicArray,
  Stack,
  Queue,
  HashTable,
  HashSet,
  MinHeap,
  AVLTree,
  BTree,
  runLab,
} from "@integrity/engine";
import { defaultSettings } from "@integrity/shared";
import type { Document, Trace } from "@integrity/shared";
import { demoDocuments } from "../frontend/demo-data/documents";
const brute = (text: string, pattern: string) => {
  const out: number[] = [];
  if (!pattern) return out;
  for (let i = 0; i <= text.length - pattern.length; i++)
    if (text.slice(i, i + pattern.length) === pattern) out.push(i);
  return out;
};
describe("matching against independent reference implementations", () => {
  it("KMP and Rabin–Karp match naive search over deterministic random examples", () => {
    const random = seededRandom(419);
    for (let t = 0; t < 300; t++) {
      const text = Array.from({ length: Math.floor(random() * 55) }, () =>
          String.fromCharCode(97 + Math.floor(random() * 4)),
        ).join(""),
        pattern = Array.from({ length: Math.floor(random() * 9) }, () =>
          String.fromCharCode(97 + Math.floor(random() * 4)),
        ).join("");
      expect(kmp(text, pattern)).toEqual(brute(text, pattern));
      expect(rabinKarp(text, pattern)).toEqual(brute(text, pattern));
    }
  });
  it("Z values match a naive prefix comparison", () => {
    for (const text of ["", "a", "aaaaaa", "aabcaabxaaaz", "banana"]) {
      const expected = Array.from({ length: text.length }, (_, i) => {
        if (i === 0) return 0;
        let j = 0;
        while (i + j < text.length && text[j] === text[i + j]) j++;
        return j;
      });
      expect(zAlgorithm(text)).toEqual(expected);
    }
  });
  it("Aho–Corasick returns all overlaps including failure-link outputs", () => {
    const text = "ushers hers shehehe",
      patterns = ["he", "she", "hers", "his"];
    const expected = patterns
      .flatMap((p, i) =>
        brute(text, p).map((start) => ({
          start,
          end: start + p.length,
          pattern: i,
        })),
      )
      .sort((a, b) => a.end - b.end || a.pattern - b.pattern);
    expect(
      ahoCorasick(text, patterns).sort(
        (a, b) => a.end - b.end || a.pattern - b.pattern,
      ),
    ).toEqual(expected);
  });
});
describe("alignment", () => {
  const slowLcs = (a: string[], b: string[]): number =>
    !a.length || !b.length
      ? 0
      : a[0] === b[0]
        ? 1 + slowLcs(a.slice(1), b.slice(1))
        : Math.max(slowLcs(a.slice(1), b), slowLcs(a, b.slice(1)));
  const slowEdit = (a: string[], b: string[]): number =>
    !a.length
      ? b.length
      : !b.length
        ? a.length
        : Math.min(
            slowEdit(a.slice(1), b) + 1,
            slowEdit(a, b.slice(1)) + 1,
            slowEdit(a.slice(1), b.slice(1)) + (a[0] === b[0] ? 0 : 1),
          );
  it("matches reference LCS/edit distance and reconstructs both sides", () => {
    const examples = [
      ["a b c", "a d c"],
      ["x x a", "x a x"],
      ["", "a"],
      ["a b", ""],
      ["a b c", "a b c"],
    ];
    for (const [aa, bb] of examples) {
      const a = aa ? aa.split(" ") : [],
        b = bb ? bb.split(" ") : [],
        r = lcs(a, b);
      expect(r.length).toBe(slowLcs(a, b));
      expect(editDistance(a, b)).toBe(slowEdit(a, b));
      expect(r.alignment.flatMap((x) => (x.a === null ? [] : [x.a]))).toEqual(
        a,
      );
      expect(r.alignment.flatMap((x) => (x.b === null ? [] : [x.b]))).toEqual(
        b,
      );
    }
  });
  it("bounds expensive matrices", () =>
    expect(() => lcs(Array(257).fill("a"), [])).toThrow("256"));
});
describe("fairness, scoring, and determinism", () => {
  it("only excludes paired quotes and standalone reference headings", () => {
    const text =
      "He mentions references in prose. “A properly quoted passage here.”\nReferences\nExample reference";
    const ex = exclusions(text, []);
    expect(ex.map((e) => e.reason)).toEqual(["quotation", "references"]);
    expect(text.slice(ex[0].start, ex[0].end)).toBe(
      "“A properly quoted passage here.”",
    );
    expect(
      exclusions('An unmatched " quote and references in prose', []),
    ).toEqual([]);
  });
  it("uses the template automaton and recomputes discounts", () => {
    const text = "Discuss how shared green spaces influence urban communities.";
    const a: Document = {
        id: "a",
        title: "a",
        text,
        author: "fictional",
        kind: "submission",
        createdAt: "",
      },
      b = { ...a, id: "b" };
    const settings = { ...defaultSettings, discountTemplates: true };
    const r = analyzePair(a, b, [text.toLowerCase()], settings);
    expect(r.exclusionsA[0].reason).toBe("template");
    expect(r.score).toBe(0);
    expect(
      analyzePair(a, b, [text.toLowerCase()], {
        ...settings,
        discountTemplates: false,
      }).score,
    ).toBeGreaterThan(0);
  });
  it("discounts quotes while retaining evidence", () => {
    const a = {
        ...demoDocuments[0],
        text: "“Community gardens create shared spaces where residents exchange knowledge.”",
      },
      b = {
        ...demoDocuments[1],
        text: "Community gardens create shared spaces where residents exchange knowledge.",
      };
    const r = analyzePair(a, b, [], defaultSettings);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.score).toBe(0);
    expect(
      analyzePair(a, b, [], { ...defaultSettings, discountQuotes: false })
        .score,
    ).toBeGreaterThan(0);
  });
  it("produces deterministic corpus results, ranking and graph edges", () => {
    const templates = templatePatterns(demoDocuments),
      ps = pairs(demoDocuments),
      run = () =>
        ps.map(([a, b]) =>
          analyzePair(
            demoDocuments[a],
            demoDocuments[b],
            templates,
            defaultSettings,
          ),
        );
    const first = run();
    expect(first).toEqual(run());
    expect(first).toHaveLength(15);
    expect(
      first.some((r) =>
        r.matches.some((m) => m.kind === "fuzzy" || m.kind === "shingle"),
      ),
    ).toBe(true);
    const ranked = rankResults(first);
    expect(ranked[0].score).toBeGreaterThan(ranked.at(-1)!.score);
    expect(
      rankResults(first, "SUB-001").every(
        (r) => r.a === "SUB-001" || r.b === "SUB-001",
      ),
    ).toBe(true);
    expect(resultGraph(demoDocuments, first, 1).length).toBeGreaterThan(0);
  });
  it("marks evidence bounds honestly", () => {
    const a = {
        ...demoDocuments[0],
        text: Array(65).fill("One two three four five six.").join(" "),
      },
      b = { ...demoDocuments[1], text: "One two three four five six." };
    expect(analyzePair(a, b, [], defaultSettings).truncated).toBe(true);
  });
});
describe("graph algorithms", () => {
  const edges = [
    { from: 0, to: 1, weight: 4 },
    { from: 0, to: 2, weight: 1 },
    { from: 2, to: 1, weight: 2 },
    { from: 1, to: 3, weight: 1 },
  ];
  it("finds components and isolated nodes", () =>
    expect(components(5, edges)).toEqual([[0, 1, 2, 3], [4]]));
  it("finds shortest paths and disconnected targets", () => {
    expect(dijkstra(5, edges, 0, 3)).toEqual({
      distance: 4,
      path: [0, 2, 1, 3],
    });
    expect(dijkstra(5, edges, 0, 4)).toEqual({ distance: Infinity, path: [] });
  });
  it("returns a minimum spanning forest", () => {
    const forest = minimumSpanningForest(5, edges);
    expect(forest).toHaveLength(3);
    expect(forest.reduce((sum, e) => sum + e.weight, 0)).toBe(4);
  });
  it("computes residual maximum flow", () =>
    expect(
      maxFlow(
        4,
        [
          { from: 0, to: 1, weight: 8 },
          { from: 0, to: 2, weight: 5 },
          { from: 1, to: 2, weight: 3 },
          { from: 1, to: 3, weight: 5 },
          { from: 2, to: 3, weight: 8 },
        ],
        0,
        3,
      ),
    ).toBe(13));
});
describe("custom structures and lab traces", () => {
  it("dynamic array, stack and queue maintain order across growth", () => {
    const a = new DynamicArray<number>(),
      s = new Stack<number>(),
      q = new Queue<number>();
    for (let i = 0; i < 50; i++) {
      a.add(i);
      s.push(i);
      q.enqueue(i);
    }
    for (let i = 0; i < 50; i++) {
      expect(a.get(i)).toBe(i);
      expect(s.pop()).toBe(49 - i);
      expect(q.dequeue()).toBe(i);
    }
    expect(q.dequeue()).toBeUndefined();
  });
  it("hashes and heaps preserve values", () => {
    const table = new HashTable<number>(),
      set = new HashSet(),
      heap = new MinHeap<number>();
    for (let i = 40; i >= 0; i--) {
      table.set("key" + i, i);
      set.add("key" + i);
      heap.push(i, i);
    }
    for (let i = 0; i <= 40; i++) {
      expect(table.get("key" + i)).toBe(i);
      expect(set.has("key" + i)).toBe(true);
      expect(heap.pop()).toBe(i);
    }
  });
  it("AVL rotations preserve balance and B-tree splits emit real events", () => {
    const trace: Trace[] = [],
      avl = new AVLTree(trace),
      bt = new BTree(trace);
    for (let i = 1; i < 40; i++) {
      avl.insert(i);
      bt.insert(i);
    }
    expect(avl.root!.height).toBeLessThan(8);
    expect(avl.values()).toEqual(Array.from({ length: 39 }, (_, i) => i + 1));
    expect(trace.some((t) => t.label === "Left rotation")).toBe(true);
    expect(trace.some((t) => t.label === "Split full node")).toBe(true);
  });
  it("seeded randomness and traces are reproducible", () => {
    const a = seededRandom(9),
      b = seededRandom(9);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(runLab("KMP", "ababa", "aba")).toEqual(
      runLab("KMP", "ababa", "aba"),
    );
    expect(runLab("Dijkstra", "0 1 2 1 3 4", "").output).toContain("6");
  });
});
