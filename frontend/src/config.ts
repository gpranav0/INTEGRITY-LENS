export type DataAdapterMode = "demo" | "supabase";

export interface PublicFrontendConfiguration {
  mode: DataAdapterMode;
  supabaseUrl: string;
  supabaseAnonKey: string;
  assignmentId: string;
  errors: string[];
}

type PublicEnvironment = Partial<Record<
  | "VITE_DATA_ADAPTER"
  | "VITE_SUPABASE_URL"
  | "VITE_SUPABASE_ANON_KEY"
  | "VITE_SUPABASE_ASSIGNMENT_ID",
  string
>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readPublicConfiguration(
  environment: PublicEnvironment,
): PublicFrontendConfiguration {
  const requestedMode = (environment.VITE_DATA_ADAPTER ?? "demo").trim();
  const errors: string[] = [];
  const mode: DataAdapterMode = requestedMode === "supabase" ? "supabase" : "demo";
  if (requestedMode !== "demo" && requestedMode !== "supabase")
    errors.push("VITE_DATA_ADAPTER must be either demo or supabase.");

  const supabaseUrl = (environment.VITE_SUPABASE_URL ?? "").trim();
  const supabaseAnonKey = (environment.VITE_SUPABASE_ANON_KEY ?? "").trim();
  const assignmentId = (environment.VITE_SUPABASE_ASSIGNMENT_ID ?? "").trim();
  if (mode === "supabase") {
    if (!supabaseUrl) errors.push("VITE_SUPABASE_URL is required in Supabase mode.");
    else {
      try {
        const parsed = new URL(supabaseUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
          errors.push("VITE_SUPABASE_URL must use http or https.");
      } catch {
        errors.push("VITE_SUPABASE_URL must be a valid URL.");
      }
    }
    if (!supabaseAnonKey)
      errors.push("VITE_SUPABASE_ANON_KEY is required in Supabase mode.");
    if (!assignmentId)
      errors.push("VITE_SUPABASE_ASSIGNMENT_ID is required in Supabase mode.");
    else if (!UUID.test(assignmentId))
      errors.push("VITE_SUPABASE_ASSIGNMENT_ID must be a valid UUID.");
  }
  return { mode, supabaseUrl, supabaseAnonKey, assignmentId, errors };
}

export const publicConfiguration = readPublicConfiguration({
  VITE_DATA_ADAPTER: import.meta.env.VITE_DATA_ADAPTER,
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_SUPABASE_ASSIGNMENT_ID: import.meta.env.VITE_SUPABASE_ASSIGNMENT_ID,
});
