import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthenticationService } from "./auth";
import { configuredSupabaseBackend, configuredSupabaseClient, subscribeSessionInvalidated } from "./supabase";

export interface HostedProfile {
  id: string;
  displayName: string;
  role: string;
  email: string;
}

/** Unmount private views whenever identity changes; late requests cannot repopulate them. */
export function HostedSession({ children }: {
  children: (profile: HostedProfile, signOut: () => Promise<void>) => ReactNode;
}) {
  const client = configuredSupabaseClient();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [profile, setProfile] = useState<HostedProfile | null>(null);
  const [error, setError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [retry, setRetry] = useState(0);
  const current = useRef<Session | null>(null);
  const signingOut = useRef(false);
  const revision = useRef(0);
  const [identityVersion, setIdentityVersion] = useState(0);

  const accept = (next: Session | null) => {
    if (current.current?.user.id !== next?.user.id) {
      setProfile(null);
      setProfileError("");
      setIdentityVersion((value) => value + 1);
    }
    current.current = next;
    setSession(next);
  };

  useEffect(() => {
    let active = true;
    const startRevision = revision.current;
    const { data: listener } = client.auth.onAuthStateChange((event, next) => {
      if (!active || signingOut.current || event === "INITIAL_SESSION") return;
      revision.current++;
      const hadSession = current.current !== null;
      accept(next);
      setChecking(false);
      if (!next && hadSession) setError("Your session ended. Sign in again to continue.");
    });
    const unsubscribe = subscribeSessionInvalidated((rejectedToken) => {
      if (!active || signingOut.current) return;
      if (rejectedToken && rejectedToken !== current.current?.access_token) return;
      revision.current++;
      accept(null);
      setChecking(false);
      setError("Your session expired. Sign in again to continue.");
      // Keep SDK work outside its auth-state callback to avoid its session lock.
      void client.auth.signOut({ scope: "local" });
    });
    void new AuthenticationService(client.auth).restore().then((result) => {
      if (!active || revision.current !== startRevision) return;
      accept(result.session);
      setError(result.error);
      setChecking(false);
    });
    return () => {
      active = false;
      revision.current++;
      listener.subscription.unsubscribe();
      unsubscribe();
    };
  }, [client]);

  const userId = session?.user.id;
  const email = session?.user.email ?? "Signed-in user";
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setProfile(null);
    setProfileError("");
    void configuredSupabaseBackend().currentProfile().then((value) => {
      if (!active) return;
      if (value.id !== userId || !["admin", "instructor", "reviewer", "student"].includes(value.role))
        throw new Error("Your application profile is unavailable. Contact your administrator.");
      setProfile({ id: value.id, displayName: value.display_name, role: value.role, email });
    }).catch((failure: unknown) => {
      if (active) setProfileError(failure instanceof Error ? failure.message : "Unable to load your account. Try again.");
    });
    return () => { active = false; };
  }, [userId, email, retry]);

  async function signOut() {
    if (signingOut.current) return;
    signingOut.current = true;
    revision.current++;
    accept(null);
    setError("");
    const message = await new AuthenticationService(client.auth).signOut();
    signingOut.current = false;
    setError(message);
  }

  if (checking) return <main className="loading" role="status"><h1>Checking your session</h1><p>Opening your hosted workspace…</p></main>;
  if (!session) return <SignIn message={error} authenticate={async (email, password) => {
    const result = await new AuthenticationService(client.auth).signIn(email, password);
    revision.current++;
    accept(result.session);
    setError(result.error);
    return result.error;
  }} />;
  if (profileError) return <main className="auth-page"><section className="auth-card">
    <h1>Unable to open your account</h1><p role="alert">{profileError}</p>
    <button onClick={() => setRetry((value) => value + 1)}>Retry</button>{" "}
    <button onClick={() => void signOut()}>Sign out</button>
  </section></main>;
  if (!profile || profile.id !== session.user.id) return <main className="loading" role="status"><h1>Loading your account</h1></main>;
  return <div key={`${profile.id}:${identityVersion}`}>{children(profile, signOut)}</div>;
}

function SignIn({ message, authenticate }: { message: string; authenticate: (email: string, password: string) => Promise<string> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return <main className="auth-page"><section className="auth-card">
    <p className="eyebrow">INTEGRITYLENS · HOSTED WORKSPACE</p>
    <h1>Sign in to continue</h1>
    <p>Use your assigned account. Your administrator manages your role and course access.</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      try { await authenticate(email, password); } finally { setBusy(false); }
    }}>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {message && <p className="error" role="alert">{message}</p>}
      <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
    <p className="muted">Similarity evidence supports human review. It does not establish misconduct or detect AI-generated text.</p>
  </section></main>;
}
