import type {
  Document,
  Result,
  ReviewCase,
  Settings,
  Snapshot,
} from "./index.ts";

export interface BackendWorkspace extends Snapshot {
  assignment: {
    id: string;
    title: string;
    due_at: string | null;
    created_at: string;
    course: { id: string; title: string; instructor_id: string };
  };
}

export interface BackendJob {
  id: string;
  status: "queued" | "running" | "cancelled" | "complete" | "failed";
  completed_pairs: number;
  total_pairs: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface BackendClient {
  workspace(assignmentId: string): Promise<BackendWorkspace>;
  importDocument(assignmentId: string, document: Document): Promise<unknown>;
  startAnalysis(assignmentId: string, settings: Settings): Promise<BackendJob>;
  analysisJob(jobId: string): Promise<BackendJob>;
  cancelAnalysis(jobId: string): Promise<BackendJob>;
  analysisResults(jobId: string): Promise<Result[]>;
  openCase(resultId: string): Promise<ReviewCase>;
  addCaseNote(caseId: string, note: string): Promise<unknown>;
  transitionCase(
    caseId: string,
    status: ReviewCase["status"],
    justification: string,
  ): Promise<ReviewCase>;
  generateReport(caseId: string): Promise<{
    reportId: string;
    downloadUrl: string;
    expiresIn: number;
  }>;
}
