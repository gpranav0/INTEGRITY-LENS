import type { Edge, Trace } from "@integrity/shared";
function cloneKeys(values: number[]) {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) result[i] = values[i];
  return result;
}
export class DynamicArray<T> {
  private data: (T | undefined)[] = new Array(4);
  length = 0;
  add(value: T) {
    if (this.length === this.data.length) {
      const next = new Array(this.length * 2);
      for (let i = 0; i < this.length; i++) next[i] = this.data[i];
      this.data = next;
    }
    this.data[this.length++] = value;
  }
  get(i: number): T {
    if (i < 0 || i >= this.length) throw new Error("Index out of bounds");
    return this.data[i] as T;
  }
  removeLast(): T | undefined {
    if (!this.length) return;
    const value = this.data[--this.length];
    this.data[this.length] = undefined;
    return value;
  }
}
export class Stack<T> extends DynamicArray<T> {
  push(v: T) {
    this.add(v);
  }
  pop() {
    return this.removeLast();
  }
}
export class Queue<T> {
  private data = new DynamicArray<T>();
  private head = 0;
  enqueue(v: T) {
    this.data.add(v);
  }
  dequeue(): T | undefined {
    return this.head < this.data.length
      ? this.data.get(this.head++)
      : undefined;
  }
  get length() {
    return this.data.length - this.head;
  }
}
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
type Entry<T> = { key: string; value: T; next?: Entry<T> };
export class HashTable<T> {
  private buckets: (Entry<T> | undefined)[] = new Array(257);
  set(key: string, value: T) {
    const bucket = hashString(key) % this.buckets.length;
    let entry = this.buckets[bucket];
    while (entry) {
      if (entry.key === key) {
        entry.value = value;
        return;
      }
      entry = entry.next;
    }
    this.buckets[bucket] = { key, value, next: this.buckets[bucket] };
  }
  get(key: string): T | undefined {
    let entry = this.buckets[hashString(key) % this.buckets.length];
    while (entry) {
      if (entry.key === key) return entry.value;
      entry = entry.next;
    }
    return undefined;
  }
}
export class HashSet {
  private table = new HashTable<boolean>();
  add(key: string) {
    this.table.set(key, true);
  }
  has(key: string) {
    return this.table.get(key) === true;
  }
}
export class MinHeap<T> {
  private data: { value: T; priority: number }[] = [];
  get length() {
    return this.data.length;
  }
  push(value: T, priority: number) {
    let i = this.data.length;
    this.data[i] = { value, priority };
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.data[p].priority <= priority) break;
      const tmp = this.data[p];
      this.data[p] = this.data[i];
      this.data[i] = tmp;
      i = p;
    }
  }
  pop(): T | undefined {
    if (!this.data.length) return;
    const value = this.data[0].value;
    const last = this.data[this.data.length - 1];
    this.data.length--;
    if (this.data.length) {
      this.data[0] = last;
      let i = 0;
      while (true) {
        let child = i * 2 + 1;
        if (child >= this.data.length) break;
        if (
          child + 1 < this.data.length &&
          this.data[child + 1].priority < this.data[child].priority
        )
          child++;
        if (this.data[i].priority <= this.data[child].priority) break;
        const tmp = this.data[i];
        this.data[i] = this.data[child];
        this.data[child] = tmp;
        i = child;
      }
    }
    return value;
  }
}
export class UnionFind {
  parent: number[] = [];
  rank: number[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.rank[i] = 0;
    }
  }
  rootOf(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.rootOf(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number) {
    a = this.rootOf(a);
    b = this.rootOf(b);
    if (a === b) return false;
    if (this.rank[a] < this.rank[b]) {
      const t = a;
      a = b;
      b = t;
    }
    this.parent[b] = a;
    if (this.rank[a] === this.rank[b]) this.rank[a]++;
    return true;
  }
}
interface AVLNode {
  key: number;
  height: number;
  left: AVLNode | null;
  right: AVLNode | null;
}
export class AVLTree {
  root: AVLNode | null = null;
  constructor(private trace?: Trace[]) {}
  private h(n: AVLNode | null) {
    return n ? n.height : 0;
  }
  private rotate(n: AVLNode, left: boolean): AVLNode {
    const top = (left ? n.right : n.left)!;
    if (left) {
      n.right = top.left;
      top.left = n;
    } else {
      n.left = top.right;
      top.right = n;
    }
    n.height = 1 + Math.max(this.h(n.left), this.h(n.right));
    top.height = 1 + Math.max(this.h(top.left), this.h(top.right));
    if (this.trace)
      this.trace[this.trace.length] = {
        label: left ? "Left rotation" : "Right rotation",
        values: [n.key, top.key],
        active: [1],
        detail: "Rotate to restore AVL height balance.",
      };
    return top;
  }
  insert(key: number) {
    const put = (n: AVLNode | null): AVLNode => {
      if (!n) return { key, height: 1, left: null, right: null };
      if (key < n.key) n.left = put(n.left);
      else if (key > n.key) n.right = put(n.right);
      else return n;
      n.height = 1 + Math.max(this.h(n.left), this.h(n.right));
      const balance = this.h(n.left) - this.h(n.right);
      if (balance > 1) {
        if (key > n.left!.key) n.left = this.rotate(n.left!, true);
        return this.rotate(n, false);
      }
      if (balance < -1) {
        if (key < n.right!.key) n.right = this.rotate(n.right!, false);
        return this.rotate(n, true);
      }
      return n;
    };
    this.root = put(this.root);
    if (this.trace)
      this.trace[this.trace.length] = {
        label: "Insert " + key,
        values: this.values(),
        active: [],
        detail: "Balanced ordered index; root " + this.root.key,
      };
  }
  values() {
    const out: number[] = [];
    const walk = (n: AVLNode | null) => {
      if (n) {
        walk(n.left);
        out[out.length] = n.key;
        walk(n.right);
      }
    };
    walk(this.root);
    return out;
  }
}
interface BNode {
  keys: number[];
  children: BNode[];
  leaf: boolean;
}
export class BTree {
  root: BNode = { keys: [], children: [], leaf: true };
  constructor(private trace?: Trace[]) {}
  private splitChild(p: BNode, i: number) {
    const y = p.children[i],
      z: BNode = { keys: [y.keys[2]], children: [], leaf: y.leaf },
      mid = y.keys[1];
    if (!y.leaf) {
      z.children = [y.children[2], y.children[3]];
      y.children.length = 2;
    }
    y.keys.length = 1;
    for (let j = p.children.length; j > i + 1; j--)
      p.children[j] = p.children[j - 1];
    p.children[i + 1] = z;
    for (let j = p.keys.length; j > i; j--) p.keys[j] = p.keys[j - 1];
    p.keys[i] = mid;
    if (this.trace)
      this.trace[this.trace.length] = {
        label: "Split full node",
        values: [y.keys[0], mid, z.keys[0]],
        active: [1],
        detail: "Promote median " + mid + " to the parent (minimum degree 2).",
      };
  }
  insert(k: number) {
    if (this.root.keys.length === 3) {
      const p: BNode = { keys: [], children: [this.root], leaf: false };
      this.root = p;
      this.splitChild(p, 0);
    }
    const add = (n: BNode) => {
      let i = n.keys.length - 1;
      if (n.leaf) {
        while (i >= 0 && k < n.keys[i]) {
          n.keys[i + 1] = n.keys[i];
          i--;
        }
        n.keys[i + 1] = k;
      } else {
        while (i >= 0 && k < n.keys[i]) i--;
        i++;
        if (n.children[i].keys.length === 3) {
          this.splitChild(n, i);
          if (k > n.keys[i]) i++;
        }
        add(n.children[i]);
      }
    };
    add(this.root);
    if (this.trace)
      this.trace[this.trace.length] = {
        label: "Insert " + k,
        values: cloneKeys(this.root.keys),
        active: [],
        detail: "Root keys after insertion. B-tree nodes hold up to 3 keys.",
      };
  }
}
export class WeightedGraph {
  adjacency: Edge[][] = [];
  constructor(
    public size: number,
    public edges: Edge[],
    directed = false,
  ) {
    for (let i = 0; i < size; i++) this.adjacency[i] = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      this.adjacency[e.from][this.adjacency[e.from].length] = e;
      if (!directed)
        this.adjacency[e.to][this.adjacency[e.to].length] = {
          from: e.to,
          to: e.from,
          weight: e.weight,
        };
    }
  }
}
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
