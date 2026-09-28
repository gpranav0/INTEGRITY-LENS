import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseBackendClient,
  subscribeSessionInvalidated,
} from "../frontend/src/supabase";

const activeSession = {
  access_token: "access-token-that-must-not-leak",
  user: { id: "user-1" },
} as Session;

function client() {
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: activeSession }, error: null })),
    },
  } as unknown as SupabaseClient;
}

afterEach(() => vi.unstubAllGlobals());

describe("hosted backend request boundary", () => {
  it("notifies the session boundary when the backend rejects the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: "Authentication is required." }),
      { status: 401, headers: { "content-type": "application/json" } },
    )));
    const invalidated = vi.fn();
    const unsubscribe = subscribeSessionInvalidated(invalidated);
    const backend = new SupabaseBackendClient(
      { url: "https://example.supabase.co", publishableKey: "public-key" },
      client(),
    );

    await expect(backend.currentProfile()).rejects.toMatchObject({ status: 401 });
    expect(invalidated).toHaveBeenCalledWith(activeSession.access_token);
    unsubscribe();
  });

  it("does not expose an unreadable backend response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private upstream detail", { status: 500 })));
    const backend = new SupabaseBackendClient(
      { url: "https://example.supabase.co", publishableKey: "public-key" },
      client(),
    );

    await expect(backend.currentProfile()).rejects.toThrow("The backend returned an unreadable response.");
  });
});
