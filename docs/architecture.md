# Architecture and algorithm limits

IntegrityLens is a local academic review demonstration. It supports human judgment and never declares misconduct. There is no AI-generated-text detector, internet source search, authorship model, or citation-verification service.

## Boundaries

- `frontend`: React, React Router, plain CSS, Cytoscape, IndexedDB adapter, report renderer, and Web Worker. No external font, image, API, or authentication calls are used in demo mode. Vite's local development connection is the only network activity beyond local assets.
- `packages/shared`: versionable document, result, case, trace, repository, and future-service contracts.
- `packages/engine`: pure TypeScript with no React, DOM, Node, Deno, storage, or network dependency. It uses indexed loops, custom hash tables, heaps, queues, trees, and union-find. Matching, score calculation, ranking, component grouping, forest calculation, and paths stay here.
- `demo-data`: fictional sample corpus for verbatim overlap, lightly changed wording, proper quotation, assignment templates, a three-submission chain, and independent work. Scores are generated at runtime; none are seeded.
- `supabase`: future SQL/RLS/storage design. Not run or verified.

## Data and worker flow

1. Load the IndexedDB `integritylens-local-v1` database, `workspace` object store, `snapshot` key. When absent, use the fictional corpus. A storage error is surfaced instead of silently substituting a new dataset.
2. Imported documents are individually validated. Pasted documents use an explicit identifier. File imports use the filename without `.txt`. A fatal UTF-8 decoder rejects bad byte sequences. Binary NUL, replacement characters, blank text, duplicate identifiers, and limit violations are rejected.
3. Imports clear stale result data. Historical case notes are preserved and evidence links explain that reanalysis is needed.
4. Run all non-template pairs that include at least one submission in a dedicated worker. The worker posts progress only after completed pairs. Cancel terminates the worker. Only a completed batch replaces persisted results.
5. Persist a settings snapshot with results. Changing preferences marks results as using older settings; recomputation is explicit. Saved documents/results/cases use IndexedDB; localStorage is restricted to theme, role, and score preferences.
6. Browser saves are queued to preserve ordering. Storage failures appear in a notification. Browser storage is mutable and may be cleared by the user or browser; this is not durable institutional storage or a secure audit trail. Concurrent tabs are not synchronized; use one active workspace tab.

## Match pipeline

Tokenization retains source offsets and normalizes ASCII A–Z to lowercase. ASCII punctuation separates tokens. Non-ASCII code points are treated as word characters without language-specific case folding or segmentation. English teaching text is the intended sample corpus; this is not a multilingual tokenizer.

Sentences/newlines form candidate passages, with a safety boundary at 650 characters. Passages shorter than five tokens are not scored. KMP searches normalized full source text for exact token sequences. If a passage has no exact match, it is compared with source passages using token LCS. The highest LCS similarity candidate is retained if `2 × LCS / (left tokens + right tokens) >= 0.50`. Its 3-word shingle Jaccard score determines the label: at least 0.24 means shingle, otherwise fuzzy. This is lexical overlap; changed meaning and reordered or synonym-heavy writing may be missed.

Each component is the average matched-token coverage across both documents, expressed as a percentage. Non-exact matches contribute passage LCS similarity to their covered tokens. Within a component a token contributes at most its best match. The overall score is the weighted mean of the three components, with default weights 0.5 / 0.3 / 0.2. Consequently identical texts need not score 100: an entirely exact match contributes through the exact component. Scores are comparative signals, not calibrated estimates of intent or originality.

## Fairness heuristics

- Quotes: paired straight double quotes or curly double quotes enclosing at least 12 characters. Unmatched quotes are ignored; apostrophes and nested quoting are not parsed.
- References: a standalone `References` or `Bibliography` heading, optionally followed by a colon, excludes everything after the heading. False positives are possible.
- Templates: case-insensitive verbatim template passage matching through Aho–Corasick. Formatting or punctuation changes can prevent a match.
- Every detected span remains inspectable. When an enabled span overlaps any part of a match on either side, the whole match is discounted. No bibliographic source is verified.

## Bounded work

Maximum 30 documents, 20,000 UTF-8 bytes and 1,200 whitespace-delimited words per document. At most 60 candidate passages per side, 128 tokens per fuzzy passage, 80 retained matches per pair. Truncation is flagged on the result and reports. Exact passages may exceed the fuzzy limit. Word alignment caps each selected passage to 256 tokens and discloses clipping. Template documents do not become analysis pairs. The comparison is directional in its passage selection, with submission-first and insertion-order orientation; the coverage score averages both sides. Ranking should always be interpreted with these limits.

## Graph and learning tools

Graph edges come from actual results above the selected threshold. Edge distance is `101 − score`. Union-find groups components, a heap-based Kruskal algorithm builds the minimum spanning forest, and Dijkstra computes shortest paths. Isolated documents remain visible. Timestamps never imply a copying direction.

KMP and Aho–Corasick are used in production demo matching; LCS supports fuzzy comparison and evidence alignment. Lab-only alternatives are Rabin–Karp, Z, edit distance, AVL, B-tree, and max-flow. They are actual engine implementations with optional trace collectors, not alternate animations. Ranking uses stable insertion sort at this bounded dataset size. The custom dynamic array, stack, queue, hash table/set, heap, AVL, B-tree, weighted graph, union-find, and seeded PRNG have unit coverage. Lab traces are capped at 500 events and inputs at 160/80 characters; graphs have eight nodes.

## Verification

`npm run lint` applies scoped AST lint restrictions and a second TypeScript AST checker. They reject built-in Map/Set, regex literals, common array/string searching/transformation shortcuts, and environment-specific imports in the engine. These are regression guards for this source, not a security sandbox against intentionally obfuscated code.

Unit tests compare matchers with naive references, verify alignment reconstruction, test exclusions and score recomputation, inspect graph results, and check storage/import behavior. Playwright covers the end-to-end review, strict file errors, persistence/reset isolation, lab traces, graph access, keyboard navigation, themes, and 360px page overflow.
