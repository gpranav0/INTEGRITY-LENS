import type {
  Document,
  Result,
  Settings,
  ReviewCase,
  CaseStatus,
  CaseEvent,
} from "./index.ts";
/** Future service contracts. No network transport is instantiated in demo mode. */
export interface DocumentService {
  list(assignmentId: string): Promise<Document[]>;
  import(assignmentId: string, document: Document): Promise<Document>;
}
export interface AnalysisService {
  start(assignmentId: string, settings: Settings): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<void>;
  progress(jobId: string): Promise<{
    done: number;
    total: number;
    status: "queued" | "running" | "complete" | "cancelled" | "failed";
  }>;
  results(jobId: string): Promise<Result[]>;
}
export interface CaseService {
  list(assignmentId: string): Promise<ReviewCase[]>;
  open(resultId: string): Promise<ReviewCase>;
  transition(
    id: string,
    status: CaseStatus,
    justification: string,
  ): Promise<ReviewCase>;
  addNote(id: string, note: string): Promise<CaseEvent>;
}
export interface ReportService {
  generate(caseId: string): Promise<{ reportId: string; downloadUrl: string }>;
}
