import type { Session } from "@supabase/supabase-js";

export interface AuthClient {
  getSession(): Promise<{ data: { session: Session | null }; error: { message: string } | null }>;
  refreshSession(): Promise<{ data: { session: Session | null }; error: { message: string } | null }>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { session: Session | null };
    error: { message: string } | null;
  }>;
  signOut(): Promise<{ error: { message: string } | null }>;
}

export interface AuthenticationResult {
  session: Session | null;
  error: string;
}

export function canOpenWorkspace(mode: "demo" | "supabase", session: Session | null) {
  return mode === "demo" || session !== null;
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export class AuthenticationService {
  constructor(
    private readonly auth: AuthClient,
    private readonly nowSeconds = () => Math.floor(Date.now() / 1000),
  ) {}

  async restore(): Promise<AuthenticationResult> {
    try {
      const restored = await this.auth.getSession();
      if (restored.error)
        return { session: null, error: `Unable to restore your session: ${restored.error.message}` };
      if (!restored.data.session) return { session: null, error: "" };
      const expiresAt = restored.data.session.expires_at;
      if (expiresAt !== undefined && expiresAt <= this.nowSeconds()) {
        const refreshed = await this.auth.refreshSession();
        if (refreshed.error || !refreshed.data.session)
          return {
            session: null,
            error: "Your session expired. Sign in again to continue.",
          };
        return { session: refreshed.data.session, error: "" };
      }
      return { session: restored.data.session, error: "" };
    } catch (error) {
      return {
        session: null,
        error: message(error, "Supabase is currently unavailable. Check your connection and try again."),
      };
    }
  }

  async signIn(email: string, password: string): Promise<AuthenticationResult> {
    if (!email.trim() || !password)
      return { session: null, error: "Email and password are required." };
    try {
      const result = await this.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error || !result.data.session)
        return { session: null, error: result.error?.message ?? "Sign-in failed." };
      return { session: result.data.session, error: "" };
    } catch (error) {
      return {
        session: null,
        error: message(error, "Unable to reach Supabase. Check your connection and try again."),
      };
    }
  }

  async signOut(): Promise<string> {
    try {
      const result = await this.auth.signOut();
      return result.error ? `Unable to sign out: ${result.error.message}` : "";
    } catch (error) {
      return message(error, "Unable to reach Supabase while signing out.");
    }
  }
}
