export type DocumentKind = "submission" | "reference" | "template";
export interface Document {
  id: string;
  title: string;
  author: string;
  kind: DocumentKind;
  text: string;
  createdAt: string;
}
export type MatchKind = "exact" | "shingle" | "fuzzy";
export interface Exclusion {
  start: number;
  end: number;
  reason: "quotation" | "references" | "template";
}
export interface Match {
  id: string;
  kind: MatchKind;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  similarity: number;
  excluded: boolean;
  reasons: string[];
}
export interface Components {
  exact: number;
  shingle: number;
  fuzzy: number;
}
export interface Result {
  id: string;
  a: string;
  b: string;
  score: number;
  components: Components;
  matches: Match[];
  exclusionsA: Exclusion[];
  exclusionsB: Exclusion[];
  truncated: boolean;
}
export interface Settings {
  weights: Components;
  discountQuotes: boolean;
  discountReferences: boolean;
  discountTemplates: boolean;
  threshold: number;
}
export const defaultSettings: Settings = {
  weights: { exact: 0.5, shingle: 0.3, fuzzy: 0.2 },
  discountQuotes: true,
  discountReferences: true,
  discountTemplates: true,
  threshold: 15,
};
export type CaseStatus =
  "New" | "Under review" | "Needs discussion" | "Resolved" | "Closed";
export interface CaseEvent {
  at: string;
  role: string;
  text: string;
}
export interface ReviewCase {
  id: string;
  resultId: string;
  status: CaseStatus;
  events: CaseEvent[];
}
export interface Snapshot {
  documents: Document[];
  results: Result[];
  cases: ReviewCase[];
  analyzedAt: string | null;
  analysisSettings: Settings | null;
}
export interface Repository {
  load(): Promise<Snapshot | null>;
  save(data: Snapshot): Promise<void>;
  reset(): Promise<void>;
}
export interface Trace {
  label: string;
  values: number[];
  active: number[];
  detail: string;
}
export interface Edge {
  from: number;
  to: number;
  weight: number;
}
export * from "./backend.ts";
