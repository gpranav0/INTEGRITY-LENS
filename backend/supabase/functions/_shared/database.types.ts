export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<{
        id: string;
        display_name: string;
        role: Database["public"]["Enums"]["app_role"];
      }>;
      courses: Table<{
        id: string;
        title: string;
        instructor_id: string;
        created_at: string;
      }>;
      course_members: Table<{ course_id: string; profile_id: string }>;
      assignments: Table<{
        id: string;
        course_id: string;
        title: string;
        due_at: string | null;
        created_at: string;
      }>;
      documents: Table<{
        id: string;
        assignment_id: string;
        owner_id: string;
        identifier: string;
        title: string;
        kind: Database["public"]["Enums"]["document_kind"];
        storage_path: string;
        byte_size: number;
        word_count: number;
        content_sha256: string | null;
        version: number;
        created_at: string;
      }>;
      templates: Table<{
        id: string;
        assignment_id: string;
        document_id: string;
        created_at: string;
      }>;
      analysis_jobs: Table<{
        id: string;
        assignment_id: string;
        requested_by: string;
        status: "queued" | "running" | "cancelled" | "complete" | "failed";
        settings: Json;
        engine_version: string;
        completed_pairs: number;
        total_pairs: number;
        created_at: string;
        started_at: string | null;
        completed_at: string | null;
        cancelled_at: string | null;
        error_message: string | null;
        document_snapshot: Json;
      }>;
      analysis_results: Table<{
        id: string;
        job_id: string;
        document_a: string;
        document_b: string;
        score: number;
        components: Json;
        exclusions_a: Json;
        exclusions_b: Json;
        truncated: boolean;
        created_at: string;
      }>;
      matches: Table<{
        id: string;
        result_id: string;
        kind: "exact" | "shingle" | "fuzzy";
        a_start: number;
        a_end: number;
        b_start: number;
        b_end: number;
        similarity: number;
        excluded: boolean;
        reasons: Json;
      }>;
      cases: Table<{
        id: string;
        result_id: string;
        created_by: string;
        status: Database["public"]["Enums"]["case_status"];
        resolution_justification: string | null;
        created_at: string;
        updated_at: string;
      }>;
      reviewer_assignments: Table<{
        case_id: string;
        reviewer_id: string;
        assigned_by: string;
        created_at: string;
      }>;
      case_events: Table<{
        id: string;
        case_id: string;
        actor_id: string;
        event_type: string;
        note: string;
        created_at: string;
      }>;
      reports: Table<{
        id: string;
        case_id: string;
        created_by: string;
        storage_path: string;
        created_at: string;
        engine_version: string;
        byte_size: number | null;
        content_type: string;
      }>;
      settings: Table<{
        assignment_id: string;
        weights: Json;
        fairness: Json;
        updated_by: string;
        updated_at: string;
      }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      backend_open_case: {
        Args: { p_result_id: string; p_actor_id: string };
        Returns: Database["public"]["Tables"]["cases"]["Row"];
      };
      backend_add_case_note: {
        Args: { p_case_id: string; p_actor_id: string; p_note: string };
        Returns: Database["public"]["Tables"]["case_events"]["Row"];
      };
      backend_transition_case: {
        Args: {
          p_case_id: string;
          p_actor_id: string;
          p_status: Database["public"]["Enums"]["case_status"];
          p_justification: string;
        };
        Returns: Database["public"]["Tables"]["cases"]["Row"];
      };
      backend_cancel_job: {
        Args: { p_job_id: string; p_actor_id: string };
        Returns: Database["public"]["Tables"]["analysis_jobs"]["Row"];
      };
    };
    Enums: {
      app_role: "admin" | "instructor" | "reviewer" | "student";
      document_kind: "submission" | "reference" | "template";
      case_status:
        "New" | "Under review" | "Needs discussion" | "Resolved" | "Closed";
    };
    CompositeTypes: { [_ in never]: never };
  };
}
