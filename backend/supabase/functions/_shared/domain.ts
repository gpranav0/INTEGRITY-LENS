import type { CaseStatus, DocumentKind, Settings } from "@integrity/shared";

export const MAX_DOCUMENT_BYTES = 20_000;
export const MAX_DOCUMENT_WORDS = 1_200;
export const MAX_DOCUMENTS = 30;
export const ENGINE_VERSION = "1.0.0";
export const PRIVATE_BUCKET = "integritylens-private";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_error",
  ) {
    super(message);
  }
}

export function requiredString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || !value.trim())
    throw new ApiError(400, `${name} is required.`, "validation_error");
  const result = value.trim();
  if (result.length > maxLength)
    throw new ApiError(
      400,
      `${name} must be at most ${maxLength} characters.`,
      "validation_error",
    );
  return result;
}

export function uuid(value: unknown, name: string): string {
  const result = requiredString(value, name, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      result,
    )
  )
    throw new ApiError(400, `${name} must be a UUID.`, "validation_error");
  return result.toLowerCase();
}

export interface DocumentInput {
  assignmentId: string;
  identifier: string;
  title: string;
  kind: DocumentKind;
  text: string;
}

export function validateDocumentInput(body: unknown): DocumentInput {
  if (!body || typeof body !== "object")
    throw new ApiError(400, "A JSON document is required.");
  const value = body as Record<string, unknown>;
  const assignmentId = uuid(value.assignmentId, "assignmentId");
  const identifier = requiredString(value.identifier, "identifier", 48);
  if (!/^[A-Za-z0-9_-]+$/.test(identifier))
    throw new ApiError(
      400,
      "identifier may contain only letters, numbers, hyphens, and underscores.",
      "validation_error",
    );
  const title = requiredString(value.title, "title", 240);
  if (!["submission", "reference", "template"].includes(String(value.kind)))
    throw new ApiError(400, "kind is invalid.", "validation_error");
  if (typeof value.text !== "string" || !value.text.trim())
    throw new ApiError(400, "text is required.", "validation_error");
  if (value.text.includes("\u0000") || value.text.includes("\ufffd"))
    throw new ApiError(
      400,
      "text contains invalid characters.",
      "validation_error",
    );
  const bytes = new TextEncoder().encode(value.text).byteLength;
  if (bytes > MAX_DOCUMENT_BYTES)
    throw new ApiError(413, "Document exceeds the 20 KB limit.", "limit_error");
  const words = value.text.trim().split(/\s+/u).length;
  if (words > MAX_DOCUMENT_WORDS)
    throw new ApiError(
      413,
      "Document exceeds the 1,200-word limit.",
      "limit_error",
    );
  return {
    assignmentId,
    identifier,
    title,
    kind: value.kind as DocumentKind,
    text: value.text,
  };
}

export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== "object")
    throw new ApiError(400, "settings are required.", "validation_error");
  const input = value as Record<string, unknown>;
  const weights = input.weights as Record<string, unknown> | undefined;
  const exact = finiteRange(weights?.exact, "weights.exact", 0, 1);
  const shingle = finiteRange(weights?.shingle, "weights.shingle", 0, 1);
  const fuzzy = finiteRange(weights?.fuzzy, "weights.fuzzy", 0, 1);
  if (exact + shingle + fuzzy <= 0)
    throw new ApiError(400, "At least one score weight must be positive.");
  return {
    weights: { exact, shingle, fuzzy },
    discountQuotes: boolean(input.discountQuotes, "discountQuotes"),
    discountReferences: boolean(input.discountReferences, "discountReferences"),
    discountTemplates: boolean(input.discountTemplates, "discountTemplates"),
    threshold: finiteRange(input.threshold, "threshold", 0, 100),
  };
}

function finiteRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    throw new ApiError(
      400,
      `${name} must be between ${minimum} and ${maximum}.`,
      "validation_error",
    );
  return value;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean")
    throw new ApiError(400, `${name} must be a boolean.`, "validation_error");
  return value;
}

export function nextCaseStatus(status: CaseStatus): CaseStatus | null {
  const order: CaseStatus[] = [
    "New",
    "Under review",
    "Needs discussion",
    "Resolved",
    "Closed",
  ];
  const index = order.indexOf(status);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
}

export function routePath(url: string): string {
  const pathname = new URL(url).pathname;
  const marker = "/integrity-api";
  const index = pathname.indexOf(marker);
  if (index < 0) return pathname;
  const result = pathname.slice(index + marker.length);
  return result || "/";
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
