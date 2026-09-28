import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { AuthenticationService, canOpenWorkspace, type AuthClient } from "../frontend/src/auth";
import { readPublicConfiguration } from "../frontend/src/config";

const session = (expiresAt = 2_000): Session =>
  ({ access_token: "test-token", expires_at: expiresAt, user: { id: "user-1" } }) as Session;

function client(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    refreshSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe("frontend Supabase configuration", () => {
  it("keeps demo mode usable without authentication or Supabase variables", () => {
    const configuration = readPublicConfiguration({ VITE_DATA_ADAPTER: "demo" });
    expect(configuration.errors).toEqual([]);
    expect(canOpenWorkspace(configuration.mode, null)).toBe(true);
  });

  it("reports every missing Supabase build variable", () => {
    const configuration = readPublicConfiguration({ VITE_DATA_ADAPTER: "supabase" });
    expect(configuration.errors).toHaveLength(3);
    expect(configuration.errors.join(" ")).toContain("VITE_SUPABASE_URL");
    expect(configuration.errors.join(" ")).toContain("VITE_SUPABASE_ANON_KEY");
    expect(configuration.errors.join(" ")).toContain("VITE_SUPABASE_ASSIGNMENT_ID");
  });

  it("requires a session for a Supabase-backed workspace", () => {
    expect(canOpenWorkspace("supabase", null)).toBe(false);
    expect(canOpenWorkspace("supabase", session())).toBe(true);
  });
});

describe("Supabase authentication lifecycle", () => {
  it("restores no session without treating it as an error", async () => {
    await expect(new AuthenticationService(client()).restore()).resolves.toEqual({ session: null, error: "" });
  });

  it("restores an active session", async () => {
    const active = session();
    const result = await new AuthenticationService(client({
      getSession: vi.fn(async () => ({ data: { session: active }, error: null })),
    }), () => 1_000).restore();
    expect(result).toEqual({ session: active, error: "" });
  });

  it("reports invalid credentials without retaining a session", async () => {
    const result = await new AuthenticationService(client({
      signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: { message: "Invalid login credentials" } })),
    })).signIn("person@example.test", "wrong");
    expect(result.session).toBeNull();
    expect(result.error).toBe("Invalid login credentials");
  });

  it("returns the session after successful sign-in", async () => {
    const active = session();
    const result = await new AuthenticationService(client({
      signInWithPassword: vi.fn(async () => ({ data: { session: active }, error: null })),
    })).signIn("person@example.test", "correct");
    expect(result).toEqual({ session: active, error: "" });
  });

  it("signs out through Supabase", async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    await expect(new AuthenticationService(client({ signOut })).signOut()).resolves.toBe("");
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("refreshes an expired session and asks for sign-in when refresh fails", async () => {
    const expired = session(900);
    const service = new AuthenticationService(client({
      getSession: vi.fn(async () => ({ data: { session: expired }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: null }, error: { message: "expired" } })),
    }), () => 1_000);
    await expect(service.restore()).resolves.toEqual({
      session: null,
      error: "Your session expired. Sign in again to continue.",
    });
  });
});
