import { describe, expect, it } from "vitest";
import {
  ApiError,
  escapeHtml,
  nextCaseStatus,
  routePath,
  validateDocumentInput,
  validateSettings,
} from "../backend/supabase/functions/_shared/domain.ts";
import { backendReportHtml } from "../backend/supabase/functions/_shared/report.ts";
import { defaultSettings } from "@integrity/shared";
import type { Document, Result, ReviewCase } from "@integrity/shared";

const assignmentId = "10000000-0000-4000-8000-000000000001";

describe("Supabase backend request validation", () => {
  it("accepts a bounded UTF-8 document and normalizes identifiers", () => {
    const value = validateDocumentInput({
      assignmentId: assignmentId.toUpperCase(),
      identifier: " SUB-009 ",
      title: " A title ",
      kind: "submission",
      text: "A short, fictional academic document.",
    });
    expect(value.assignmentId).toBe(assignmentId);
    expect(value.identifier).toBe("SUB-009");
    expect(value.title).toBe("A title");
  });

  it("rejects invalid identifiers, binary characters, limits, and kinds", () => {
    const input = {
      assignmentId,
      identifier: "SUB-009",
      title: "Title",
      kind: "submission",
      text: "Valid words here.",
    };
    expect(() =>
      validateDocumentInput({ ...input, identifier: "../secret" }),
    ).toThrow(ApiError);
    expect(() =>
      validateDocumentInput({ ...input, text: "bad\0text" }),
    ).toThrow("invalid characters");
    expect(() =>
      validateDocumentInput({ ...input, text: "x".repeat(20_001) }),
    ).toThrow("20 KB");
    expect(() =>
      validateDocumentInput({ ...input, text: "word ".repeat(1_201) }),
    ).toThrow("1,200-word");
    expect(() =>
      validateDocumentInput({ ...input, kind: "answer-key" }),
    ).toThrow("kind is invalid");
  });

  it("validates every score field and refuses an all-zero formula", () => {
    expect(validateSettings(defaultSettings)).toEqual(defaultSettings);
    expect(() =>
      validateSettings({
        ...defaultSettings,
        weights: { exact: 0, shingle: 0, fuzzy: 0 },
      }),
    ).toThrow("positive");
    expect(() =>
      validateSettings({ ...defaultSettings, threshold: 101 }),
    ).toThrow("between 0 and 100");
    expect(() =>
      validateSettings({ ...defaultSettings, discountQuotes: "yes" }),
    ).toThrow("boolean");
  });

  it("extracts nested Edge Function routes and enforces lifecycle order", () => {
    expect(
      routePath(
        "https://project.supabase.co/functions/v1/integrity-api/cases/abc/notes",
      ),
    ).toBe("/cases/abc/notes");
    expect(nextCaseStatus("New")).toBe("Under review");
    expect(nextCaseStatus("Resolved")).toBe("Closed");
    expect(nextCaseStatus("Closed")).toBeNull();
  });
});

describe("server report rendering", () => {
  it("escapes stored documents and append-only notes", () => {
    const documents: Document[] = [
      {
        id: "A",
        title: "<script>A</script>",
        author: "hidden",
        kind: "submission",
        text: "<img src=x> shared passage",
        createdAt: "2026-09-21",
      },
      {
        id: "B",
        title: "B",
        author: "hidden",
        kind: "reference",
        text: "<img src=x> shared passage",
        createdAt: "2026-09-21",
      },
    ];
    const result: Result = {
      id: "r",
      a: "A",
      b: "B",
      score: 25,
      components: { exact: 50, shingle: 0, fuzzy: 0 },
      matches: [
        {
          id: "m",
          kind: "exact",
          aStart: 0,
          aEnd: 25,
          bStart: 0,
          bEnd: 25,
          similarity: 1,
          excluded: false,
          reasons: [],
        },
      ],
      exclusionsA: [],
      exclusionsB: [],
      truncated: false,
    };
    const review: ReviewCase = {
      id: "c",
      resultId: "r",
      status: "Resolved",
      events: [
        { at: "2026-09-21", role: "Reviewer", text: "<svg onload=alert(1)>" },
      ],
    };
    const html = backendReportHtml(
      documents,
      result,
      review,
      "2026-09-21",
      defaultSettings,
    );
    expect(html).not.toContain("<script>A</script>");
    expect(html).not.toContain("<svg onload");
    expect(html).toContain("&lt;script&gt;A&lt;/script&gt;");
    expect(html).toContain("&lt;svg onload=alert(1)&gt;");
    expect(escapeHtml(`<&"'>`)).toBe("&lt;&amp;&quot;&#39;&gt;");
  });
});
