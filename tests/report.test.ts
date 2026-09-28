import { describe, it, expect } from "vitest";
import { escapeHtml, reportHtml } from "../frontend/src/report";
import { analyzePair } from "@integrity/engine";
import { defaultSettings } from "@integrity/shared";
import { demoDocuments } from "../frontend/demo-data/documents";
describe("report escaping", () => {
  it("escapes markup in titles, passages and reviewer notes", () => {
    const a = {
      ...demoDocuments[0],
      title: '<script>alert("title")</script>',
      text: "<img src=x onerror=alert(1)> These fictional gardens improve community participation.",
    };
    const b = { ...demoDocuments[1], text: a.text };
    const result = analyzePair(a, b, [], defaultSettings);
    const review = {
      id: "case",
      resultId: result.id,
      status: "Resolved" as const,
      events: [
        {
          at: "2026-09-20",
          role: "Reviewer",
          text: '<svg onload=alert(1)> & "note"',
        },
      ],
    };
    const html = reportHtml(
      {
        documents: [a, b],
        results: [result],
        cases: [review],
        analyzedAt: "2026-09-20",
        analysisSettings: defaultSettings,
      },
      result,
      review,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;svg onload=alert(1)&gt;");
    expect(html).toContain(
      "Similarity does not establish intent or authorship.",
    );
    expect(escapeHtml(`<&"'>`)).toBe("&lt;&amp;&quot;&#39;&gt;");
  });
});
