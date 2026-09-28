import type { Trace, Edge } from "@integrity/shared";
import {
  HashTable,
  Queue,
  MinHeap,
  UnionFind,
  WeightedGraph,
} from "./structures.ts";
export function copyNumbers(a: number[]) {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return out;
}
function emit(
  trace: Trace[] | undefined,
  label: string,
  values: number[],
  active: number[],
  detail: string,
) {
  if (trace && trace.length < 500)
    trace[trace.length] = {
      label,
      values: copyNumbers(values),
      active,
      detail,
    };
}
export function kmpFailure(pattern: string, trace?: Trace[]) {
  const pi: number[] = [];
  if (pattern.length) pi[0] = 0;
  for (let i = 1; i < pattern.length; i++) {
    let j = pi[i - 1];
    while (j > 0 && pattern.charCodeAt(i) !== pattern.charCodeAt(j))
      j = pi[j - 1];
    if (pattern.charCodeAt(i) === pattern.charCodeAt(j)) j++;
    pi[i] = j;
    emit(
      trace,
      "Failure function · position " + i,
      pi,
      [i],
      "Longest proper prefix also matching a suffix: " + j,
    );
  }
  return pi;
}
export function kmp(text: string, pattern: string, trace?: Trace[]) {
  const hits: number[] = [];
  if (!pattern.length) return hits;
  const pi = kmpFailure(pattern, trace);
  let j = 0;
  for (let i = 0; i < text.length; i++) {
    while (j > 0 && text.charCodeAt(i) !== pattern.charCodeAt(j)) j = pi[j - 1];
    if (text.charCodeAt(i) === pattern.charCodeAt(j)) j++;
    if (j === pattern.length) {
      hits[hits.length] = i - j + 1;
      emit(
        trace,
        "Exact match",
        hits,
        [hits.length - 1],
        "Pattern starts at character " + (i - j + 1),
      );
      j = pi[j - 1];
    }
  }
  return hits;
}
export function rabinKarp(text: string, pattern: string, trace?: Trace[]) {
  const hits: number[] = [];
  const n = pattern.length;
  if (!n || n > text.length) return hits;
  const mod = 1000000007,
    base = 257;
  let power = 1,
    ph = 0,
    th = 0;
  for (let i = 0; i < n; i++) {
    ph = (ph * base + pattern.charCodeAt(i)) % mod;
    th = (th * base + text.charCodeAt(i)) % mod;
    if (i < n - 1) power = (power * base) % mod;
  }
  for (let i = 0; i <= text.length - n; i++) {
    let match = ph === th;
    if (match)
      for (let j = 0; j < n; j++)
        if (text.charCodeAt(i + j) !== pattern.charCodeAt(j)) {
          match = false;
          break;
        }
    if (match) hits[hits.length] = i;
    emit(
      trace,
      "Window " + i,
      [ph, th],
      [1],
      match
        ? "Hash and characters match."
        : "Rolling hash compared with pattern hash.",
    );
    if (i < text.length - n)
      th =
        ((((th - text.charCodeAt(i) * power) % mod) + mod) * base +
          text.charCodeAt(i + n)) %
        mod;
  }
  return hits;
}
export function zAlgorithm(s: string, trace?: Trace[]) {
  const z: number[] = [];
  for (let i = 0; i < s.length; i++) z[i] = 0;
  let l = 0,
    r = 0;
  for (let i = 1; i < s.length; i++) {
    if (i <= r) z[i] = Math.min(r - i + 1, z[i - l]);
    while (i + z[i] < s.length && s.charCodeAt(z[i]) === s.charCodeAt(i + z[i]))
      z[i]++;
    if (i + z[i] - 1 > r) {
      l = i;
      r = i + z[i] - 1;
    }
    emit(
      trace,
      "Z value · " + i,
      z,
      [i],
      "Prefix match length " + z[i] + "; active window " + l + "–" + r,
    );
  }
  return z;
}
interface ACNode {
  next: HashTable<number>;
  links: number[];
  codes: number[];
  fail: number;
  output: number[];
}
export function ahoCorasick(text: string, patterns: string[], trace?: Trace[]) {
  const nodes: ACNode[] = [];
  const node = (): ACNode => ({
    next: new HashTable<number>(),
    links: [],
    codes: [],
    fail: 0,
    output: [],
  });
  nodes[0] = node();
  for (let p = 0; p < patterns.length; p++) {
    let s = 0;
    for (let j = 0; j < patterns[p].length; j++) {
      const code = patterns[p].charCodeAt(j),
        key = "" + code;
      let next = nodes[s].next.get(key);
      if (next === undefined) {
        next = nodes.length;
        nodes[next] = node();
        nodes[s].next.set(key, next);
        nodes[s].links[nodes[s].links.length] = next;
        nodes[s].codes[nodes[s].codes.length] = code;
      }
      s = next;
    }
    if (patterns[p].length) nodes[s].output[nodes[s].output.length] = p;
  }
  const q = new Queue<number>();
  for (let i = 0; i < nodes[0].links.length; i++) q.enqueue(nodes[0].links[i]);
  while (q.length) {
    const r = q.dequeue()!;
    for (let i = 0; i < nodes[r].links.length; i++) {
      const s = nodes[r].links[i],
        key = "" + nodes[r].codes[i];
      q.enqueue(s);
      let f = nodes[r].fail;
      while (f && nodes[f].next.get(key) === undefined) f = nodes[f].fail;
      nodes[s].fail = nodes[f].next.get(key) ?? 0;
      const output = nodes[nodes[s].fail].output;
      for (let j = 0; j < output.length; j++)
        nodes[s].output[nodes[s].output.length] = output[j];
    }
  }
  const hits: { start: number; end: number; pattern: number }[] = [];
  let s = 0;
  for (let i = 0; i < text.length; i++) {
    const key = "" + text.charCodeAt(i);
    while (s && nodes[s].next.get(key) === undefined) s = nodes[s].fail;
    s = nodes[s].next.get(key) ?? 0;
    for (let j = 0; j < nodes[s].output.length; j++) {
      const p = nodes[s].output[j];
      hits[hits.length] = {
        start: i - patterns[p].length + 1,
        end: i + 1,
        pattern: p,
      };
    }
    emit(
      trace,
      "Automaton · character " + i,
      [s, nodes[s].fail, hits.length],
      [0],
      "Current state, failure link, and total pattern matches.",
    );
  }
  return hits;
}
export interface Alignment {
  a: string | null;
  b: string | null;
  equal: boolean;
}
export function lcs(a: string[], b: string[], trace?: Trace[]) {
  if (a.length > 256 || b.length > 256)
    throw new Error("LCS is limited to 256 tokens per side.");
  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [];
    for (let j = 0; j <= b.length; j++) dp[i][j] = 0;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    emit(
      trace,
      "LCS row " + i,
      dp[i],
      [i],
      "Longest shared subsequence after " + i + " left tokens.",
    );
  }
  let i = a.length,
    j = b.length;
  const reverse: Alignment[] = [];
  while (i || j) {
    if (i && j && a[i - 1] === b[j - 1]) {
      reverse[reverse.length] = { a: a[--i], b: b[--j], equal: true };
    } else if (j && (!i || dp[i][j - 1] >= dp[i - 1][j]))
      reverse[reverse.length] = { a: null, b: b[--j], equal: false };
    else reverse[reverse.length] = { a: a[--i], b: null, equal: false };
  }
  const alignment: Alignment[] = [];
  for (let k = reverse.length - 1; k >= 0; k--)
    alignment[alignment.length] = reverse[k];
  return { length: dp[a.length][b.length], alignment };
}
export function editDistance(a: string[], b: string[], trace?: Trace[]) {
  if (a.length > 256 || b.length > 256)
    throw new Error("Edit distance is limited to 256 tokens.");
  let row: number[] = [];
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const next: number[] = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        row[j] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
    emit(
      trace,
      "Edit distance row " + i,
      row,
      [],
      "Minimum insertions, deletions, or substitutions for this prefix.",
    );
  }
  return row[b.length];
}
export function components(size: number, edges: Edge[], trace?: Trace[]) {
  const uf = new UnionFind(size);
  for (let i = 0; i < edges.length; i++) {
    uf.union(edges[i].from, edges[i].to);
    emit(
      trace,
      "Union " + edges[i].from + " + " + edges[i].to,
      uf.parent,
      [edges[i].from, edges[i].to],
      "Join document groups connected by similarity evidence.",
    );
  }
  const groups: number[][] = [];
  const roots = new HashTable<number>();
  for (let i = 0; i < size; i++) {
    const root = uf.rootOf(i);
    let g = roots.get("" + root);
    if (g === undefined) {
      g = groups.length;
      roots.set("" + root, g);
      groups[g] = [];
    }
    groups[g][groups[g].length] = i;
  }
  return groups;
}
export function minimumSpanningForest(size: number, edges: Edge[]) {
  const heap = new MinHeap<Edge>();
  for (let i = 0; i < edges.length; i++) heap.push(edges[i], edges[i].weight);
  const uf = new UnionFind(size),
    out: Edge[] = [];
  while (heap.length) {
    const e = heap.pop()!;
    if (uf.union(e.from, e.to)) out[out.length] = e;
  }
  return out;
}
export function dijkstra(
  size: number,
  edges: Edge[],
  start: number,
  end: number,
  trace?: Trace[],
) {
  const graph = new WeightedGraph(size, edges),
    distance: number[] = [],
    previous: number[] = [];
  for (let i = 0; i < size; i++) {
    distance[i] = Infinity;
    previous[i] = -1;
  }
  distance[start] = 0;
  const heap = new MinHeap<number>();
  heap.push(start, 0);
  while (heap.length) {
    const u = heap.pop()!;
    const adjacent = graph.adjacency[u];
    for (let i = 0; i < adjacent.length; i++) {
      const e = adjacent[i];
      if (e.weight < 0)
        throw new Error("Dijkstra requires nonnegative weights.");
      if (distance[u] + e.weight < distance[e.to]) {
        distance[e.to] = distance[u] + e.weight;
        previous[e.to] = u;
        heap.push(e.to, distance[e.to]);
      }
    }
    emit(
      trace,
      "Visit node " + u,
      distance,
      [u],
      "Relax adjacent edges; labels show shortest known distances.",
    );
  }
  const reverse: number[] = [];
  if (distance[end] !== Infinity) {
    let u = end;
    while (u !== -1) {
      reverse[reverse.length] = u;
      u = previous[u];
    }
  }
  const path: number[] = [];
  for (let i = reverse.length - 1; i >= 0; i--) path[path.length] = reverse[i];
  return { distance: distance[end], path };
}
export function maxFlow(
  size: number,
  edges: Edge[],
  source: number,
  sink: number,
  trace?: Trace[],
) {
  if (source === sink) return 0;
  const residual: number[][] = [];
  for (let i = 0; i < size; i++) {
    residual[i] = [];
    for (let j = 0; j < size; j++) residual[i][j] = 0;
  }
  for (let i = 0; i < edges.length; i++)
    residual[edges[i].from][edges[i].to] += edges[i].weight;
  let total = 0;
  while (true) {
    const prev: number[] = [];
    for (let i = 0; i < size; i++) prev[i] = -1;
    prev[source] = source;
    const q = new Queue<number>();
    q.enqueue(source);
    while (q.length && prev[sink] === -1) {
      const u = q.dequeue()!;
      for (let v = 0; v < size; v++)
        if (prev[v] === -1 && residual[u][v] > 0) {
          prev[v] = u;
          q.enqueue(v);
        }
    }
    if (prev[sink] === -1) break;
    let flow = Infinity;
    for (let v = sink; v !== source; v = prev[v])
      flow = Math.min(flow, residual[prev[v]][v]);
    for (let v = sink; v !== source; v = prev[v]) {
      residual[prev[v]][v] -= flow;
      residual[v][prev[v]] += flow;
    }
    total += flow;
    emit(
      trace,
      "Augment flow by " + flow,
      prev,
      [sink],
      "Residual network BFS found a path; cumulative flow " + total,
    );
  }
  return total;
}
