import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  DemoAdapter,
  SupabaseAdapter,
  validateDocument,
  readTextFile,
} from "../frontend/src/data";
import { demoDocuments } from "../frontend/demo-data/documents";
describe("local data boundary", () => {
  it("persists documents, cases, results and resets only its own store", async () => {
    const adapter = new DemoAdapter(),
      snapshot = {
        documents: demoDocuments,
        results: [],
        cases: [],
        analyzedAt: null,
        analysisSettings: null,
      };
    await adapter.save(snapshot);
    expect(await new DemoAdapter().load()).toEqual(snapshot);
    await adapter.reset();
    expect(await adapter.load()).toBeNull();
  });
  it("rejects duplicates, blank text, bad identifiers, binary content and oversize imports", () => {
    const valid = { id: "NEW-001", title: "New", text: "A valid document." };
    expect(() => validateDocument(valid, demoDocuments)).not.toThrow();
    expect(() =>
      validateDocument({ ...valid, id: "SUB-001" }, demoDocuments),
    ).toThrow("already exists");
    expect(() => validateDocument({ ...valid, text: " " }, [])).toThrow(
      "empty",
    );
    expect(() => validateDocument({ ...valid, id: "../x" }, [])).toThrow(
      "letters",
    );
    expect(() => validateDocument({ ...valid, text: "\0binary" }, [])).toThrow(
      "encoding",
    );
    expect(() =>
      validateDocument({ ...valid, text: "a".repeat(20001) }, []),
    ).toThrow("20 KB");
    expect(() =>
      validateDocument({ ...valid, text: "word ".repeat(1201) }, []),
    ).toThrow("1,200");
  });
  it("decodes UTF-8 strictly and validates file type", async () => {
    expect(await readTextFile(new File(["hello"], "ok.txt"))).toBe("hello");
    await expect(
      readTextFile(new File([new Uint8Array([0xc3, 0x28])], "bad.txt")),
    ).rejects.toThrow("UTF-8");
    await expect(readTextFile(new File(["hello"], "bad.pdf"))).rejects.toThrow(
      ".txt",
    );
  });
  it("does not silently fake a future backend", async () => {
    await expect(new SupabaseAdapter().load()).rejects.toThrow(
      "VITE_SUPABASE_ASSIGNMENT_ID is required",
    );
  });
});
