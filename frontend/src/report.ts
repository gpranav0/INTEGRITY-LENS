import type { Snapshot, Result, ReviewCase } from "@integrity/shared";
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function reportHtml(
  data: Snapshot,
  result: Result,
  review?: ReviewCase,
) {
  const a = data.documents.find((d) => d.id === result.a)!,
    b = data.documents.find((d) => d.id === result.b)!;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>IntegrityLens report ${escapeHtml(result.id)}</title><style>body{font:16px/1.6 system-ui;max-width:960px;margin:40px auto;padding:24px;color:#18293a}article{border:1px solid #ccd5db;padding:20px;margin:18px 0}small{color:#53626e}blockquote{margin:10px 0;padding:10px;border-left:3px solid #248479}h1,h2{line-height:1.2}@media print{body{margin:0}}</style><h1>IntegrityLens · Review report</h1><p>Local demo · Fictional teaching corpus and locally imported documents</p><h2>${escapeHtml(a.title)} ↔ ${escapeHtml(b.title)}</h2><p>Identifiers: ${escapeHtml(a.id)} / ${escapeHtml(b.id)}. Author metadata omitted.</p><p>Analyzed: ${escapeHtml(data.analyzedAt ?? "Unknown")}. Similarity score: ${result.score.toFixed(1)} / 100</p><p>Exact: ${result.components.exact.toFixed(1)} · Shingle: ${result.components.shingle.toFixed(1)} · Fuzzy: ${result.components.fuzzy.toFixed(1)}</p><p>Settings used: ${escapeHtml(JSON.stringify(data.analysisSettings))}</p><p>Formula: weighted mean of exact, shingle, and fuzzy coverage; coverage averages the two documents. Discounted evidence contributes zero. Components are lexical measures, not calibrated probabilities.</p>${result.matches.map((m) => `<article><b>${m.kind} · ${(m.similarity * 100).toFixed(0)}% passage similarity ${m.excluded ? "· EXCLUDED: " + escapeHtml(m.reasons.join(", ")) : ""}</b><small> · left characters ${m.aStart}–${m.aEnd}; right ${m.bStart}–${m.bEnd}</small><blockquote>${escapeHtml(a.text.slice(m.aStart, m.aEnd))}</blockquote><blockquote>${escapeHtml(b.text.slice(m.bStart, m.bEnd))}</blockquote></article>`).join("")}<h2>Detected exclusion spans</h2>${[...result.exclusionsA.map((e) => ({ ...e, side: a.id, text: a.text })), ...result.exclusionsB.map((e) => ({ ...e, side: b.id, text: b.text }))].map((e) => `<p><b>${escapeHtml(e.side)} · ${e.reason} · ${e.start}–${e.end}</b><br>${escapeHtml(e.text.slice(e.start, e.end))}</p>`).join("")}<h2>Local review history · ${review?.status ?? "No case opened"}</h2>${review?.events.map((e) => `<p>${escapeHtml(e.at)} · ${escapeHtml(e.role)}<br>${escapeHtml(e.text)}</p>`).join("") ?? "<p>No reviewer notes.</p>"}<h2>Limitations</h2><p>Similarity does not establish intent or authorship. This app does not detect AI-generated text. Quotations, citations, templates, and permitted collaboration require context. Exclusions are conservative heuristics, not citation verification. Local case history is editable browser data, not a server-enforced immutable audit trail. Demo roles are not security boundaries.</p><p>${result.truncated ? "Evidence was truncated by analysis limits." : "No evidence limit reached for this pair."} Analysis considers at most 60 passages per document, 128 tokens per fuzzy passage, and 80 matches per pair. It does not search the web.</p></html>`;
}
export function downloadReport(html: string, id: string) {
  const url = URL.createObjectURL(
    new Blob([html], { type: "text/html;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `integritylens-${id}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
