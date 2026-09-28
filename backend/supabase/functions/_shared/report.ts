import type { Document, Result, ReviewCase, Settings } from "@integrity/shared";
import { escapeHtml } from "./domain.ts";

export function backendReportHtml(
  documents: Document[],
  result: Result,
  review: ReviewCase,
  analyzedAt: string,
  settings: Settings,
): string {
  const left = documents.find((document) => document.id === result.a);
  const right = documents.find((document) => document.id === result.b);
  if (!left || !right) throw new Error("Report documents are unavailable.");
  const passages = result.matches
    .map(
      (match, index) =>
        `<article><h3>${index + 1}. ${escapeHtml(match.kind)} · ${(match.similarity * 100).toFixed(1)}%${match.excluded ? ` · EXCLUDED: ${escapeHtml(match.reasons.join(", "))}` : ""}</h3>` +
        `<p>Left ${match.aStart}–${match.aEnd}; right ${match.bStart}–${match.bEnd}</p>` +
        `<blockquote>${escapeHtml(left.text.slice(match.aStart, match.aEnd))}</blockquote>` +
        `<blockquote>${escapeHtml(right.text.slice(match.bStart, match.bEnd))}</blockquote></article>`,
    )
    .join("");
  const events = review.events
    .map(
      (event) =>
        `<p>${escapeHtml(event.at)} · ${escapeHtml(event.role)}<br>${escapeHtml(event.text)}</p>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>IntegrityLens report</title><style>body{font:16px/1.6 system-ui;max-width:960px;margin:40px auto;padding:24px;color:#18293a}article{border:1px solid #ccd5db;padding:20px;margin:18px 0}blockquote{margin:10px 0;padding:10px;border-left:3px solid #248479}h1,h2{line-height:1.2}@media print{body{margin:0}}</style><h1>IntegrityLens · Review report</h1><h2>${escapeHtml(left.title)} ↔ ${escapeHtml(right.title)}</h2><p>Identifiers: ${escapeHtml(left.id)} / ${escapeHtml(right.id)}. Author metadata omitted.</p><p>Analyzed ${escapeHtml(analyzedAt)}. Similarity score ${result.score.toFixed(1)} / 100.</p><p>Exact ${result.components.exact.toFixed(1)} · Shingle ${result.components.shingle.toFixed(1)} · Fuzzy ${result.components.fuzzy.toFixed(1)}</p><p>Settings: ${escapeHtml(JSON.stringify(settings))}</p><h2>Passage evidence</h2>${passages || "<p>No passages met the matching thresholds.</p>"}<h2>Review history · ${escapeHtml(review.status)}</h2>${events || "<p>No reviewer notes.</p>"}<h2>Limitations</h2><p>Similarity does not establish intent or authorship. This app does not detect AI-generated text. Quotations, citations, templates, and permitted collaboration require context. Exclusions are heuristics rather than citation verification.</p><p>${result.truncated ? "Evidence was truncated by analysis limits." : "No evidence limit was reached for this pair."}</p></html>`;
}
