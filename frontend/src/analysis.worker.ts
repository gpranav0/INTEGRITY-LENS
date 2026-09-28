import { analyzePair, pairs, templatePatterns } from "@integrity/engine";
import type { Document, Settings, Result } from "@integrity/shared";
self.onmessage = (
  event: MessageEvent<{ documents: Document[]; settings: Settings }>,
) => {
  try {
    const { documents, settings } = event.data,
      ps = pairs(documents),
      templates = templatePatterns(documents),
      results: Result[] = [];
    self.postMessage({ type: "progress", done: 0, total: ps.length });
    for (let i = 0; i < ps.length; i++) {
      results.push(
        analyzePair(
          documents[ps[i][0]],
          documents[ps[i][1]],
          templates,
          settings,
        ),
      );
      self.postMessage({ type: "progress", done: i + 1, total: ps.length });
    }
    self.postMessage({ type: "complete", results });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Analysis failed.",
    });
  }
};
