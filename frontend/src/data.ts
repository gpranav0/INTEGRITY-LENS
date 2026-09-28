import type { Repository, Snapshot, Document } from "@integrity/shared";
import { publicConfiguration } from "./config";
export const DB_NAME = "integritylens-local-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export class DemoAdapter implements Repository {
  async load(): Promise<Snapshot | null> {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("workspace", "readonly"),
        r = tx.objectStore("workspace").get("snapshot");
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
      tx.oncomplete = () => db.close();
    });
  }
  async save(data: Snapshot) {
    const db = await database();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(data, "snapshot");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }
  async reset() {
    const db = await database();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }
}
/**
 * Read boundary for a configured, authenticated Supabase workspace. Mutations use
 * the operation-specific service client rather than unsafe whole-snapshot writes.
 */
export class SupabaseAdapter implements Repository {
  private fingerprint: string | null = null;
  async load(): Promise<Snapshot | null> {
    const assignmentId = publicConfiguration.assignmentId;
    if (!assignmentId)
      throw new Error(
        "VITE_SUPABASE_ASSIGNMENT_ID is required for Supabase mode.",
      );
    const { configuredSupabaseBackend } = await import("./supabase");
    const workspace = await configuredSupabaseBackend().workspace(assignmentId);
    const snapshot: Snapshot = {
      documents: workspace.documents,
      results: workspace.results,
      cases: workspace.cases,
      analyzedAt: workspace.analyzedAt,
      analysisSettings: workspace.analysisSettings,
    };
    this.fingerprint = JSON.stringify(snapshot);
    return snapshot;
  }
  async save(data: Snapshot): Promise<void> {
    if (this.fingerprint === JSON.stringify(data)) return;
    throw new Error(
      "Supabase changes must use the operation-specific backend APIs; whole-workspace writes are refused.",
    );
  }
  async reset(): Promise<void> {
    throw new Error(
      "Server workspaces cannot be reset from the demo reset control.",
    );
  }
}
export function createRepository(): Repository {
  return publicConfiguration.mode === "supabase"
    ? new SupabaseAdapter()
    : new DemoAdapter();
}
export const MAX_BYTES = 20_000;
export function validateDocument(
  input: Pick<Document, "id" | "title" | "text">,
  existing: Document[],
) {
  if (!input.id.trim() || !input.title.trim())
    throw new Error("Identifier and title are required.");
  if (existing.some((d) => d.id === input.id.trim()))
    throw new Error("This document identifier already exists.");
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(input.id))
    throw new Error(
      "Use 1–48 letters, numbers, hyphens or underscores for the identifier.",
    );
  if (!input.text.trim()) throw new Error("The document is empty.");
  if (new TextEncoder().encode(input.text).length > MAX_BYTES)
    throw new Error("Maximum file size is 20 KB.");
  if (input.text.split(/\s+/).length > 1200)
    throw new Error("Maximum document length is 1,200 words.");
  if (input.text.includes("\u0000") || input.text.includes("\ufffd"))
    throw new Error("Text contains invalid encoding or binary characters.");
}
export async function readTextFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".txt"))
    throw new Error("Only UTF-8 .txt files are supported.");
  if (file.size > MAX_BYTES) throw new Error("Maximum file size is 20 KB.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new Error("Invalid UTF-8 encoding. Save this file as UTF-8 text.");
  }
}
