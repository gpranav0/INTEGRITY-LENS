import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BackendClient,
  BackendJob,
  BackendWorkspace,
  Document,
  Result,
  ReviewCase,
  Settings,
} from "@integrity/shared";
import { publicConfiguration } from "./config";

export interface SupabaseConfiguration {
  url: string;
  publishableKey: string;
}

export interface HostedCaseSummary {
  id: string;
  result_id: string;
  status: ReviewCase["status"];
  created_at?: string;
  updated_at?: string;
}

export interface HostedCaseDetail {
  review: ReviewCase;
  result: Result;
  documents: Document[];
  analyzedAt: string | null;
  settings: Settings | null;
  blindReview: boolean;
}

let browserClient: SupabaseClient | null = null;
const invalidationListeners = new Set<(accessToken: string | null) => void>();

export function subscribeSessionInvalidated(
  listener: (accessToken: string | null) => void,
) {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export class BackendRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BackendRequestError";
  }
}

export function configuredSupabaseClient(): SupabaseClient {
  if (publicConfiguration.errors.length || publicConfiguration.mode !== "supabase")
    throw new Error(publicConfiguration.errors[0] ?? "Supabase mode is not enabled.");
  if (!browserClient)
    browserClient = createClient(
      publicConfiguration.supabaseUrl,
      publicConfiguration.supabaseAnonKey,
    );
  return browserClient;
}

export class SupabaseBackendClient implements BackendClient {
  readonly supabase;

  constructor(
    private configuration: SupabaseConfiguration,
    client?: SupabaseClient,
  ) {
    if (!configuration.url || !configuration.publishableKey)
      throw new Error(
        "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required for Supabase mode.",
      );
    this.supabase = client ?? createClient(configuration.url, configuration.publishableKey);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const {
      data: { session },
      error,
    } = await this.supabase.auth.getSession();
    if (error || !session)
      throw new Error(
        "A real Supabase session is required. Demo roles are not authentication.",
      );
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(`${this.configuration.url}/functions/v1/integrity-api${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          apikey: this.configuration.publishableKey,
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw new Error("The hosted service did not respond in time. Try again.");
      throw new Error("Unable to reach the hosted service. Check your connection and try again.");
    } finally {
      globalThis.clearTimeout(timeout);
    }
    const body = (await response.json().catch(() => ({
      error: "The backend returned an unreadable response.",
    }))) as { error?: string };
    if (!response.ok) {
      if (response.status === 401)
        invalidationListeners.forEach((listener) => listener(session.access_token));
      throw new BackendRequestError(
        body.error ?? `Backend request failed (${response.status}).`, response.status,
      );
    }
    return body as T;
  }

  workspace(assignmentId: string): Promise<BackendWorkspace> {
    return this.request(
      `/workspace?assignmentId=${encodeURIComponent(assignmentId)}`,
    );
  }

  currentProfile(): Promise<{ id: string; display_name: string; role: string }> {
    return this.request("/me");
  }

  listCases(): Promise<HostedCaseSummary[]> {
    return this.request("/cases");
  }

  caseEvidence(caseId: string): Promise<HostedCaseDetail> {
    return this.request(`/cases/${encodeURIComponent(caseId)}`);
  }

  documentDownload(documentId: string): Promise<{ downloadUrl: string; expiresIn: number }> {
    return this.request(`/documents/${encodeURIComponent(documentId)}/download`);
  }

  importDocument(assignmentId: string, document: Document): Promise<unknown> {
    return this.request("/documents", {
      method: "POST",
      body: JSON.stringify({
        assignmentId,
        identifier: document.id,
        title: document.title,
        kind: document.kind,
        text: document.text,
      }),
    });
  }

  startAnalysis(assignmentId: string, settings: Settings): Promise<BackendJob> {
    return this.request("/analysis-jobs", {
      method: "POST",
      body: JSON.stringify({ assignmentId, settings }),
    });
  }

  analysisJob(jobId: string): Promise<BackendJob> {
    return this.request(`/analysis-jobs/${encodeURIComponent(jobId)}`);
  }

  cancelAnalysis(jobId: string): Promise<BackendJob> {
    return this.request(`/analysis-jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      body: "{}",
    });
  }

  analysisResults(jobId: string): Promise<Result[]> {
    return this.request(`/analysis-jobs/${encodeURIComponent(jobId)}/results`);
  }

  async openCase(resultId: string): Promise<ReviewCase> {
    const row = await this.request<{
      id: string;
      result_id: string;
      status: ReviewCase["status"];
    }>("/cases", {
      method: "POST",
      body: JSON.stringify({ resultId }),
    });
    return {
      id: row.id,
      resultId: row.result_id,
      status: row.status,
      events: [],
    };
  }

  addCaseNote(caseId: string, note: string): Promise<unknown> {
    return this.request(`/cases/${encodeURIComponent(caseId)}/notes`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
  }

  async transitionCase(
    caseId: string,
    status: ReviewCase["status"],
    justification: string,
  ): Promise<ReviewCase> {
    const row = await this.request<{
      id: string;
      result_id: string;
      status: ReviewCase["status"];
    }>(`/cases/${encodeURIComponent(caseId)}/transition`, {
      method: "POST",
      body: JSON.stringify({ status, justification }),
    });
    return {
      id: row.id,
      resultId: row.result_id,
      status: row.status,
      events: [],
    };
  }

  generateReport(caseId: string) {
    return this.request<{
      reportId: string;
      downloadUrl: string;
      expiresIn: number;
    }>(`/cases/${encodeURIComponent(caseId)}/reports`, {
      method: "POST",
      body: "{}",
    });
  }
}

export function configuredSupabaseBackend() {
  return new SupabaseBackendClient({
    url: publicConfiguration.supabaseUrl,
    publishableKey: publicConfiguration.supabaseAnonKey,
  }, configuredSupabaseClient());
}
