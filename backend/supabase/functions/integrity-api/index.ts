import { createClient } from "supabase";
import type { SupabaseClient, User } from "supabase";
import { corsHeaders } from "supabase/cors";
import { pairs } from "@integrity/engine";
import type {
  CaseEvent,
  CaseStatus,
  Document,
  Match,
  Result,
  ReviewCase,
  Settings,
  Snapshot,
} from "@integrity/shared";
import {
  ApiError,
  ENGINE_VERSION,
  MAX_DOCUMENTS,
  PRIVATE_BUCKET,
  hex,
  requiredString,
  routePath,
  uuid,
  validateDocumentInput,
  validateSettings,
} from "../_shared/domain.ts";
import { backendReportHtml } from "../_shared/report.ts";
import type { Database, Json } from "../_shared/database.types.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type Client = SupabaseClient<Database>;
type Role = "admin" | "instructor" | "reviewer" | "student";
interface Profile {
  id: string;
  display_name: string;
  role: Role;
}
interface RequestContext {
  user: User;
  profile: Profile;
  userClient: Client;
  admin: Client;
}
interface StoredDocument {
  id: string;
  assignment_id: string;
  owner_id: string;
  identifier: string;
  title: string;
  kind: Document["kind"];
  storage_path: string;
  byte_size: number;
  word_count: number;
  version: number;
  created_at: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("INTEGRITYLENS_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function requestHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin":
      ALLOWED_ORIGINS.length > 0
        ? ALLOWED_ORIGINS.includes(origin)
          ? origin
          : ALLOWED_ORIGINS[0]
        : "*",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function assertOrigin(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin))
    throw new ApiError(403, "Origin is not allowed.", "origin_denied");
}

function response(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: requestHeaders(request) });
}

function dbError(
  error: { message: string; code?: string } | null,
  message: string,
): never {
  // Database messages can contain record values. Log only the stable code and
  // operation label; return a bounded public message below.
  console.error("IntegrityLens database operation failed", message, error?.code ?? "unknown");
  if (error?.code === "23505")
    throw new ApiError(409, "The record already exists.", "conflict");
  if (error?.code === "23503")
    throw new ApiError(
      400,
      "A related record does not exist.",
      "invalid_reference",
    );
  if (error?.code === "P0001") {
    const forbidden = error.message.includes("may not");
    throw new ApiError(
      forbidden ? 403 : 409,
      error.message,
      forbidden ? "forbidden" : "invalid_state",
    );
  }
  throw new ApiError(500, message, "database_error");
}

async function jsonBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 30_000)
    throw new ApiError(413, "Request body is too large.", "limit_error");
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "A valid JSON body is required.", "invalid_json");
  }
}

async function authenticate(request: Request): Promise<RequestContext> {
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SERVICE_ROLE_KEY)
    throw new ApiError(
      500,
      "Supabase function secrets are incomplete.",
      "configuration_error",
    );
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    throw new ApiError(401, "Authentication is required.", "unauthorized");
  const token = authorization.slice(7);
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user)
    throw new ApiError(
      401,
      "The session is invalid or expired.",
      "unauthorized",
    );
  const userClient = createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id,display_name,role")
    .eq("id", auth.user.id)
    .single();
  if (error || !profile) dbError(error, "Unable to load the user profile.");
  return { user: auth.user, profile: profile as Profile, userClient, admin };
}

async function assignmentCourse(admin: Client, assignmentId: string) {
  const { data: assignment, error } = await admin
    .from("assignments")
    .select("id,course_id,title,due_at,created_at")
    .eq("id", assignmentId)
    .single();
  if (error || !assignment)
    throw new ApiError(404, "Assignment not found.", "not_found");
  const { data: course, error: courseError } = await admin
    .from("courses")
    .select("id,title,instructor_id")
    .eq("id", assignment.course_id)
    .single();
  if (courseError || !course)
    dbError(courseError, "Unable to load the course.");
  return { assignment, course };
}

async function requireAssignmentManager(
  context: RequestContext,
  assignmentId: string,
) {
  const value = await assignmentCourse(context.admin, assignmentId);
  if (
    context.profile.role !== "admin" &&
    value.course.instructor_id !== context.user.id
  )
    throw new ApiError(403, "Instructor access is required.", "forbidden");
  return value;
}

async function requireCourseManager(context: RequestContext, courseId: string) {
  const { data: course, error } = await context.admin
    .from("courses")
    .select("id,title,instructor_id")
    .eq("id", courseId)
    .single();
  if (error || !course)
    throw new ApiError(404, "Course not found.", "not_found");
  if (
    context.profile.role !== "admin" &&
    course.instructor_id !== context.user.id
  )
    throw new ApiError(403, "Instructor access is required.", "forbidden");
  return course;
}

async function requireResultManager(context: RequestContext, resultId: string) {
  const { data: result, error } = await context.admin
    .from("analysis_results")
    .select("id,job_id")
    .eq("id", resultId)
    .single();
  if (error || !result)
    throw new ApiError(404, "Result not found.", "not_found");
  const { data: job, error: jobError } = await context.admin
    .from("analysis_jobs")
    .select("assignment_id")
    .eq("id", result.job_id)
    .single();
  if (jobError || !job) dbError(jobError, "Unable to load the analysis job.");
  await requireAssignmentManager(context, job.assignment_id);
  return { result, job };
}

async function requireCaseAccess(context: RequestContext, caseId: string) {
  const { data: review, error } = await context.admin
    .from("cases")
    .select("id,result_id,status,created_by,created_at,updated_at")
    .eq("id", caseId)
    .single();
  if (error || !review) throw new ApiError(404, "Case not found.", "not_found");
  if (context.profile.role === "admin") return review;
  const { result, job } = await requireResultWithoutAuthorization(
    context.admin,
    review.result_id,
  );
  const { course } = await assignmentCourse(context.admin, job.assignment_id);
  if (course.instructor_id === context.user.id) return review;
  const { data: reviewer } = await context.admin
    .from("reviewer_assignments")
    .select("case_id")
    .eq("case_id", caseId)
    .eq("reviewer_id", context.user.id)
    .maybeSingle();
  if (!reviewer)
    throw new ApiError(403, "This case is not assigned to you.", "forbidden");
  return { ...review, result_id: result.id };
}

async function requireResultWithoutAuthorization(
  admin: Client,
  resultId: string,
) {
  const { data: result, error } = await admin
    .from("analysis_results")
    .select("*")
    .eq("id", resultId)
    .single();
  if (error || !result)
    throw new ApiError(404, "Result not found.", "not_found");
  const { data: job, error: jobError } = await admin
    .from("analysis_jobs")
    .select("*")
    .eq("id", result.job_id)
    .single();
  if (jobError || !job) dbError(jobError, "Unable to load the analysis job.");
  return { result, job };
}

async function canStudentSubmit(
  context: RequestContext,
  assignmentId: string,
): Promise<boolean> {
  if (context.profile.role !== "student") return false;
  const { assignment } = await assignmentCourse(context.admin, assignmentId);
  const { data } = await context.admin
    .from("course_members")
    .select("course_id")
    .eq("course_id", assignment.course_id)
    .eq("profile_id", context.user.id)
    .maybeSingle();
  return Boolean(data);
}

async function downloadText(admin: Client, path: string): Promise<string> {
  const { data, error } = await admin.storage
    .from(PRIVATE_BUCKET)
    .download(path);
  if (error || !data)
    throw new Error(`Unable to read stored document ${path}.`);
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await data.arrayBuffer(),
  );
}

function mapMatch(row: Record<string, unknown>): Match {
  return {
    id: String(row.id),
    kind: row.kind as Match["kind"],
    aStart: Number(row.a_start),
    aEnd: Number(row.a_end),
    bStart: Number(row.b_start),
    bEnd: Number(row.b_end),
    similarity: Number(row.similarity),
    excluded: Boolean(row.excluded),
    reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
  };
}

function mapResult(
  row: Record<string, unknown>,
  matches: Record<string, unknown>[],
  identifiers: Map<string, string>,
): Result {
  const components = row.components as Result["components"];
  return {
    id: String(row.id),
    a: identifiers.get(String(row.document_a)) ?? String(row.document_a),
    b: identifiers.get(String(row.document_b)) ?? String(row.document_b),
    score: Number(row.score),
    components: {
      exact: Number(components.exact),
      shingle: Number(components.shingle),
      fuzzy: Number(components.fuzzy),
    },
    matches: matches.map(mapMatch),
    exclusionsA: Array.isArray(row.exclusions_a)
      ? (row.exclusions_a as Result["exclusionsA"])
      : [],
    exclusionsB: Array.isArray(row.exclusions_b)
      ? (row.exclusions_b as Result["exclusionsB"])
      : [],
    truncated: Boolean(row.truncated),
  };
}

async function workspace(
  context: RequestContext,
  assignmentId: string,
): Promise<Snapshot & { assignment: unknown }> {
  const assignment = await requireAssignmentManager(context, assignmentId);
  const { data: documentRows, error } = await context.admin
    .from("documents")
    .select("*")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });
  if (error) dbError(error, "Unable to load documents.");
  const stored = (documentRows ?? []) as StoredDocument[];
  const ownerIds = [...new Set(stored.map((document) => document.owner_id))];
  const { data: owners, error: ownerError } = ownerIds.length
    ? await context.admin
        .from("profiles")
        .select("id,display_name")
        .in("id", ownerIds)
    : { data: [], error: null };
  if (ownerError) dbError(ownerError, "Unable to load document owners.");
  const ownerNames = new Map(
    (owners ?? []).map((owner) => [owner.id, owner.display_name]),
  );
  const documents = await Promise.all(
    stored.map(async (document): Promise<Document> => ({
      id: document.identifier,
      title: document.title,
      author: ownerNames.get(document.owner_id) ?? "Unknown author",
      kind: document.kind,
      text: await downloadText(context.admin, document.storage_path),
      createdAt: document.created_at,
    })),
  );
  const identifiers = new Map(
    stored.map((document) => [document.id, document.identifier]),
  );
  const { data: job, error: jobError } = await context.admin
    .from("analysis_jobs")
    .select("*")
    .eq("assignment_id", assignmentId)
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobError) dbError(jobError, "Unable to load analysis state.");
  let results: Result[] = [];
  if (job) {
    const { data: resultRows, error: resultError } = await context.admin
      .from("analysis_results")
      .select("*")
      .eq("job_id", job.id);
    if (resultError) dbError(resultError, "Unable to load analysis results.");
    const ids = (resultRows ?? []).map((row) => row.id);
    const { data: matchRows, error: matchError } = ids.length
      ? await context.admin.from("matches").select("*").in("result_id", ids)
      : { data: [], error: null };
    if (matchError) dbError(matchError, "Unable to load passage evidence.");
    results = (resultRows ?? []).map((row) =>
      mapResult(
        row,
        (matchRows ?? []).filter((match) => match.result_id === row.id),
        identifiers,
      ),
    );
  }
  const resultIds = results.map((result) => result.id);
  const { data: caseRows, error: caseError } = resultIds.length
    ? await context.admin.from("cases").select("*").in("result_id", resultIds)
    : { data: [], error: null };
  if (caseError) dbError(caseError, "Unable to load cases.");
  const caseIds = (caseRows ?? []).map((review) => review.id);
  const { data: eventRows, error: eventError } = caseIds.length
    ? await context.admin
        .from("case_events")
        .select("*")
        .in("case_id", caseIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (eventError) dbError(eventError, "Unable to load case events.");
  const actorIds = [
    ...new Set((eventRows ?? []).map((event) => event.actor_id)),
  ];
  const { data: actors } = actorIds.length
    ? await context.admin.from("profiles").select("id,role").in("id", actorIds)
    : { data: [] };
  const actorRoles = new Map(
    (actors ?? []).map((actor) => [actor.id, actor.role]),
  );
  const cases: ReviewCase[] = (caseRows ?? []).map((review) => ({
    id: review.id,
    resultId: review.result_id,
    status: review.status,
    events: (eventRows ?? [])
      .filter((event) => event.case_id === review.id)
      .map((event): CaseEvent => ({
        at: event.created_at,
        role: actorRoles.get(event.actor_id) ?? "reviewer",
        text: event.note,
      })),
  }));
  return {
    documents,
    results,
    cases,
    analyzedAt: job?.completed_at ?? null,
    analysisSettings: (job?.settings as Settings | undefined) ?? null,
    assignment: { ...assignment.assignment, course: assignment.course },
  };
}

async function importDocument(context: RequestContext, request: Request) {
  const input = validateDocumentInput(await jsonBody(request));
  const manager = await isAssignmentManager(context, input.assignmentId);
  const student =
    !manager && (await canStudentSubmit(context, input.assignmentId));
  if (!manager && !student)
    throw new ApiError(
      403,
      "You may not import into this assignment.",
      "forbidden",
    );
  if (student && input.kind !== "submission")
    throw new ApiError(
      403,
      "Students may import only submissions.",
      "forbidden",
    );
  const { count, error: countError } = await context.admin
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", input.assignmentId);
  if (countError) dbError(countError, "Unable to validate the document limit.");
  if ((count ?? 0) >= MAX_DOCUMENTS)
    throw new ApiError(
      409,
      "This assignment already has 30 documents.",
      "limit_error",
    );
  const documentId = crypto.randomUUID();
  const storagePath = `assignments/${input.assignmentId}/documents/${documentId}.txt`;
  const bytes = new TextEncoder().encode(input.text);
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
  const { error: uploadError } = await context.admin.storage
    .from(PRIVATE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: "text/plain; charset=utf-8",
      upsert: false,
    });
  if (uploadError)
    throw new ApiError(500, "Unable to store the document.", "storage_error");
  const row = {
    id: documentId,
    assignment_id: input.assignmentId,
    owner_id: context.user.id,
    identifier: input.identifier,
    title: input.title,
    kind: input.kind,
    storage_path: storagePath,
    byte_size: bytes.byteLength,
    word_count: input.text.trim().split(/\s+/u).length,
    content_sha256: digest,
  };
  const { data, error } = await context.admin
    .from("documents")
    .insert(row)
    .select("*")
    .single();
  if (error || !data) {
    await context.admin.storage.from(PRIVATE_BUCKET).remove([storagePath]);
    dbError(error, "Unable to create the document record.");
  }
  if (input.kind === "template") {
    const { error: templateError } = await context.admin
      .from("templates")
      .insert({ assignment_id: input.assignmentId, document_id: documentId });
    if (templateError) {
      await context.admin.from("documents").delete().eq("id", documentId);
      await context.admin.storage.from(PRIVATE_BUCKET).remove([storagePath]);
      dbError(templateError, "Unable to register the template.");
    }
  }
  return data;
}

async function isAssignmentManager(
  context: RequestContext,
  assignmentId: string,
): Promise<boolean> {
  if (context.profile.role === "admin") return true;
  const { course } = await assignmentCourse(context.admin, assignmentId);
  return course.instructor_id === context.user.id;
}

async function startAnalysis(context: RequestContext, request: Request) {
  const body = (await jsonBody(request)) as Record<string, unknown>;
  const assignmentId = uuid(body.assignmentId, "assignmentId");
  const settings = validateSettings(body.settings);
  await requireAssignmentManager(context, assignmentId);
  const { data: active } = await context.admin
    .from("analysis_jobs")
    .select("id")
    .eq("assignment_id", assignmentId)
    .in("status", ["queued", "running"])
    .limit(1)
    .maybeSingle();
  if (active)
    throw new ApiError(409, "An analysis is already active.", "active_job");
  const { data: documents, error } = await context.admin
    .from("documents")
    .select("id,identifier,title,kind,storage_path,version,created_at")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });
  if (error) dbError(error, "Unable to load analysis documents.");
  if (!documents || documents.length < 2)
    throw new ApiError(400, "At least two eligible documents are required.");
  if (documents.length > MAX_DOCUMENTS)
    throw new ApiError(
      409,
      "Analysis is limited to 30 documents.",
      "limit_error",
    );
  const metadata = documents.map((document) => ({
    id: document.id,
    version: document.version,
    identifier: document.identifier,
    kind: document.kind,
  }));
  const structural = documents.map((document): Document => ({
    id: document.id,
    title: document.title,
    author: "",
    kind: document.kind,
    text: "",
    createdAt: document.created_at,
  }));
  const total = pairs(structural).length;
  if (!total) throw new ApiError(400, "No eligible document pairs were found.");
  const { data: job, error: jobError } = await context.admin
    .from("analysis_jobs")
    .insert({
      assignment_id: assignmentId,
      requested_by: context.user.id,
      settings: settings as unknown as Json,
      engine_version: ENGINE_VERSION,
      total_pairs: total,
      document_snapshot: metadata,
    })
    .select("id,status,total_pairs,completed_pairs,created_at")
    .single();
  if (jobError || !job) dbError(jobError, "Unable to create the analysis job.");
  EdgeRuntime.waitUntil(dispatchWorker(job.id));
  return job;
}

async function dispatchWorker(jobId: string) {
  try {
    const result = await fetch(`${SUPABASE_URL}/functions/v1/integrity-worker`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    if (result.ok) return;
    console.error("Unable to dispatch analysis worker", jobId, result.status);
  } catch (error) {
    console.error("Unable to dispatch analysis worker", jobId,
      error instanceof Error ? error.name : "NetworkError");
  }
  {
    const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin
      .from("analysis_jobs")
      .update({
        status: "failed",
        error_message: "The analysis worker could not be started.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("status", "queued");
    if (error)
      console.error("Unable to mark undispatched analysis job failed", jobId, error.code ?? "unknown");
  }
}

async function createReport(context: RequestContext, caseId: string) {
  const reviewRow = await requireCaseAccess(context, caseId);
  const { result: resultRow, job } = await requireResultWithoutAuthorization(
    context.admin,
    reviewRow.result_id,
  );
  const documentIds = [resultRow.document_a, resultRow.document_b];
  const { data: rows, error } = await context.admin
    .from("documents")
    .select("*")
    .in("id", documentIds);
  if (error || !rows || rows.length !== 2)
    dbError(error, "Unable to load report documents.");
  const documents = await Promise.all(
    (rows as StoredDocument[]).map(async (row): Promise<Document> => ({
      id: row.identifier,
      title: row.title,
      author: "Author omitted",
      kind: row.kind,
      text: await downloadText(context.admin, row.storage_path),
      createdAt: row.created_at,
    })),
  );
  const identifiers = new Map(
    (rows as StoredDocument[]).map((row) => [row.id, row.identifier]),
  );
  const { data: matches, error: matchError } = await context.admin
    .from("matches")
    .select("*")
    .eq("result_id", resultRow.id);
  if (matchError) dbError(matchError, "Unable to load report evidence.");
  const result = mapResult(resultRow, matches ?? [], identifiers);
  const { data: events, error: eventError } = await context.admin
    .from("case_events")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (eventError) dbError(eventError, "Unable to load report history.");
  const review: ReviewCase = {
    id: caseId,
    resultId: result.id,
    status: reviewRow.status,
    events: (events ?? []).map((event) => ({
      at: event.created_at,
      role: "Reviewer",
      text: event.note,
    })),
  };
  const html = backendReportHtml(
    documents,
    result,
    review,
    job.completed_at ?? new Date().toISOString(),
    job.settings as unknown as Settings,
  );
  const bytes = new TextEncoder().encode(html);
  const reportId = crypto.randomUUID();
  const path = `assignments/${job.assignment_id}/reports/${reportId}.html`;
  const { error: uploadError } = await context.admin.storage
    .from(PRIVATE_BUCKET)
    .upload(path, bytes, {
      contentType: "text/html; charset=utf-8",
      upsert: false,
    });
  if (uploadError)
    throw new ApiError(500, "Unable to store the report.", "storage_error");
  const { error: insertError } = await context.admin.from("reports").insert({
    id: reportId,
    case_id: caseId,
    created_by: context.user.id,
    storage_path: path,
    engine_version: ENGINE_VERSION,
    byte_size: bytes.byteLength,
  });
  if (insertError) {
    await context.admin.storage.from(PRIVATE_BUCKET).remove([path]);
    dbError(insertError, "Unable to create the report record.");
  }
  const { data: signed, error: signError } = await context.admin.storage
    .from(PRIVATE_BUCKET)
    .createSignedUrl(path, 300, {
      download: `integritylens-${caseId}.html`,
    });
  if (signError || !signed)
    throw new ApiError(500, "Unable to sign the report download.");
  return { reportId, downloadUrl: signed.signedUrl, expiresIn: 300 };
}

async function handle(
  request: Request,
  context: RequestContext,
): Promise<Response> {
  const path = routePath(request.url);
  const url = new URL(request.url);
  if (request.method === "GET" && path === "/me")
    return response(request, context.profile);
  if (request.method === "GET" && path === "/workspace") {
    const assignmentId = uuid(
      url.searchParams.get("assignmentId"),
      "assignmentId",
    );
    return response(request, await workspace(context, assignmentId));
  }
  if (request.method === "POST" && path === "/documents")
    return response(request, await importDocument(context, request), 201);
  const download = path.match(/^\/documents\/([0-9a-f-]+)\/download$/i);
  if (request.method === "GET" && download) {
    const documentId = uuid(download[1], "documentId");
    const { data: document } = await context.userClient
      .from("documents")
      .select("storage_path")
      .eq("id", documentId)
      .maybeSingle();
    if (!document) throw new ApiError(404, "Document not found.", "not_found");
    const { data, error } = await context.admin.storage
      .from(PRIVATE_BUCKET)
      .createSignedUrl(document.storage_path, 120);
    if (error || !data)
      throw new ApiError(500, "Unable to sign the document download.");
    return response(request, { downloadUrl: data.signedUrl, expiresIn: 120 });
  }
  if (request.method === "POST" && path === "/analysis-jobs")
    return response(request, await startAnalysis(context, request), 202);
  const jobRoute = path.match(/^\/analysis-jobs\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && jobRoute) {
    const jobId = uuid(jobRoute[1], "jobId");
    const { data, error } = await context.userClient
      .from("analysis_jobs")
      .select(
        "id,status,completed_pairs,total_pairs,error_message,created_at,started_at,completed_at,cancelled_at",
      )
      .eq("id", jobId)
      .single();
    if (error || !data)
      throw new ApiError(404, "Analysis job not found.", "not_found");
    return response(request, data);
  }
  const jobResultsRoute = path.match(
    /^\/analysis-jobs\/([0-9a-f-]+)\/results$/i,
  );
  if (request.method === "GET" && jobResultsRoute) {
    const jobId = uuid(jobResultsRoute[1], "jobId");
    const { data: job, error: jobError } = await context.userClient
      .from("analysis_jobs")
      .select("id,assignment_id,status")
      .eq("id", jobId)
      .single();
    if (jobError || !job)
      throw new ApiError(404, "Analysis job not found.", "not_found");
    await requireAssignmentManager(context, job.assignment_id);
    const { data: documents, error: documentError } = await context.admin
      .from("documents")
      .select("id,identifier")
      .eq("assignment_id", job.assignment_id);
    if (documentError)
      dbError(documentError, "Unable to load document identifiers.");
    const identifiers = new Map(
      (documents ?? []).map((document) => [document.id, document.identifier]),
    );
    const { data: rows, error: resultError } = await context.admin
      .from("analysis_results")
      .select("*")
      .eq("job_id", jobId);
    if (resultError) dbError(resultError, "Unable to load analysis results.");
    const resultIds = (rows ?? []).map((result) => result.id);
    const { data: matches, error: matchError } = resultIds.length
      ? await context.admin
          .from("matches")
          .select("*")
          .in("result_id", resultIds)
      : { data: [], error: null };
    if (matchError) dbError(matchError, "Unable to load passage evidence.");
    return response(
      request,
      (rows ?? []).map((row) =>
        mapResult(
          row,
          (matches ?? []).filter((match) => match.result_id === row.id),
          identifiers,
        ),
      ),
    );
  }
  const cancelRoute = path.match(/^\/analysis-jobs\/([0-9a-f-]+)\/cancel$/i);
  if (request.method === "POST" && cancelRoute) {
    const jobId = uuid(cancelRoute[1], "jobId");
    const { data, error } = await context.admin.rpc("backend_cancel_job", {
      p_job_id: jobId,
      p_actor_id: context.user.id,
    });
    if (error) dbError(error, "Unable to cancel the analysis job.");
    return response(request, data);
  }
  if (request.method === "POST" && path === "/cases") {
    const body = (await jsonBody(request)) as Record<string, unknown>;
    const resultId = uuid(body.resultId, "resultId");
    await requireResultManager(context, resultId);
    const { data, error } = await context.admin.rpc("backend_open_case", {
      p_result_id: resultId,
      p_actor_id: context.user.id,
    });
    if (error) dbError(error, "Unable to open the review case.");
    return response(request, data, 201);
  }
  if (request.method === "GET" && path === "/cases") {
    const { data, error } = await context.userClient
      .from("cases")
      .select("id,result_id,status,created_by,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) dbError(error, "Unable to load review cases.");
    return response(request, data ?? []);
  }
  const caseRoute = path.match(/^\/cases\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && caseRoute) {
    const caseId = uuid(caseRoute[1], "caseId");
    const review = await requireCaseAccess(context, caseId);
    const { result: resultRow, job } = await requireResultWithoutAuthorization(
      context.admin,
      review.result_id,
    );
    const { data: documentRows, error: documentError } = await context.admin
      .from("documents")
      .select("*")
      .in("id", [resultRow.document_a, resultRow.document_b]);
    if (documentError || !documentRows || documentRows.length !== 2)
      dbError(documentError, "Unable to load blind-review documents.");
    const stored = documentRows as StoredDocument[];
    const documents = await Promise.all(
      stored.map(async (row): Promise<Document> => ({
        id: row.identifier,
        title: row.title,
        author: "Author hidden",
        kind: row.kind,
        text: await downloadText(context.admin, row.storage_path),
        createdAt: row.created_at,
      })),
    );
    const identifiers = new Map(stored.map((row) => [row.id, row.identifier]));
    const { data: matches, error: matchError } = await context.admin
      .from("matches")
      .select("*")
      .eq("result_id", resultRow.id);
    if (matchError) dbError(matchError, "Unable to load passage evidence.");
    const { data: events, error: eventError } = await context.admin
      .from("case_events")
      .select("created_at,note")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });
    if (eventError) dbError(eventError, "Unable to load case history.");
    return response(request, {
      review: {
        id: review.id,
        resultId: review.result_id,
        status: review.status,
        events: (events ?? []).map((event) => ({
          at: event.created_at,
          role: "Reviewer",
          text: event.note,
        })),
      },
      result: mapResult(resultRow, matches ?? [], identifiers),
      documents,
      analyzedAt: job.completed_at,
      settings: job.settings,
      blindReview: true,
    });
  }
  const transitionRoute = path.match(/^\/cases\/([0-9a-f-]+)\/transition$/i);
  if (request.method === "POST" && transitionRoute) {
    const caseId = uuid(transitionRoute[1], "caseId");
    await requireCaseAccess(context, caseId);
    const body = (await jsonBody(request)) as Record<string, unknown>;
    const status = requiredString(body.status, "status", 32) as CaseStatus;
    if (
      !["Under review", "Needs discussion", "Resolved", "Closed"].includes(
        status,
      )
    )
      throw new ApiError(400, "status is invalid.");
    const justification = requiredString(
      body.justification,
      "justification",
      10_000,
    );
    const { data, error } = await context.admin.rpc("backend_transition_case", {
      p_case_id: caseId,
      p_actor_id: context.user.id,
      p_status: status,
      p_justification: justification,
    });
    if (error) dbError(error, "Unable to transition the review case.");
    return response(request, data);
  }
  const noteRoute = path.match(/^\/cases\/([0-9a-f-]+)\/notes$/i);
  if (request.method === "POST" && noteRoute) {
    const caseId = uuid(noteRoute[1], "caseId");
    await requireCaseAccess(context, caseId);
    const body = (await jsonBody(request)) as Record<string, unknown>;
    const note = requiredString(body.note, "note", 10_000);
    const { data, error } = await context.admin.rpc("backend_add_case_note", {
      p_case_id: caseId,
      p_actor_id: context.user.id,
      p_note: note,
    });
    if (error) dbError(error, "Unable to add the reviewer note.");
    return response(request, data, 201);
  }
  const reviewerRoute = path.match(/^\/cases\/([0-9a-f-]+)\/reviewers$/i);
  if (request.method === "POST" && reviewerRoute) {
    const caseId = uuid(reviewerRoute[1], "caseId");
    const review = await requireCaseAccess(context, caseId);
    await requireResultManager(context, review.result_id);
    const body = (await jsonBody(request)) as Record<string, unknown>;
    const reviewerId = uuid(body.reviewerId, "reviewerId");
    const { data: reviewer } = await context.admin
      .from("profiles")
      .select("id,role")
      .eq("id", reviewerId)
      .eq("role", "reviewer")
      .maybeSingle();
    if (!reviewer)
      throw new ApiError(400, "The selected profile is not a reviewer.");
    const { data, error } = await context.admin
      .from("reviewer_assignments")
      .upsert({
        case_id: caseId,
        reviewer_id: reviewerId,
        assigned_by: context.user.id,
      })
      .select("*")
      .single();
    if (error || !data) dbError(error, "Unable to assign the reviewer.");
    return response(request, data, 201);
  }
  const reportRoute = path.match(/^\/cases\/([0-9a-f-]+)\/reports$/i);
  if (request.method === "POST" && reportRoute)
    return response(
      request,
      await createReport(context, uuid(reportRoute[1], "caseId")),
      201,
    );
  if (request.method === "POST" && path === "/courses") {
    if (!["admin", "instructor"].includes(context.profile.role))
      throw new ApiError(403, "Instructor access is required.", "forbidden");
    const body = (await jsonBody(request)) as Record<string, unknown>;
    const title = requiredString(body.title, "title", 240);
    const { data, error } = await context.admin
      .from("courses")
      .insert({ title, instructor_id: context.user.id })
      .select("*")
      .single();
    if (error || !data) dbError(error, "Unable to create the course.");
    return response(request, data, 201);
  }
  const memberRoute = path.match(/^\/courses\/([0-9a-f-]+)\/members$/i);
  if (request.method === "POST" && memberRoute) {
    const courseId = uuid(memberRoute[1], "courseId");
    await requireCourseManager(context, courseId);
    const body = (await jsonBody(request)) as Record<string, unknown>;
    const profileId = uuid(body.profileId, "profileId");
    const { data, error } = await context.admin
      .from("course_members")
      .upsert({ course_id: courseId, profile_id: profileId })
      .select("*")
      .single();
    if (error || !data) dbError(error, "Unable to add the course member.");
    return response(request, data, 201);
  }
  if (request.method === "POST" && path === "/assignments") {
    const body = (await jsonBody(request)) as Record<string, unknown>;
    const courseId = uuid(body.courseId, "courseId");
    await requireCourseManager(context, courseId);
    const title = requiredString(body.title, "title", 240);
    const dueAt =
      body.dueAt == null
        ? null
        : new Date(requiredString(body.dueAt, "dueAt", 64));
    if (dueAt && Number.isNaN(dueAt.valueOf()))
      throw new ApiError(400, "dueAt is invalid.");
    const { data, error } = await context.admin
      .from("assignments")
      .insert({
        course_id: courseId,
        title,
        due_at: dueAt?.toISOString() ?? null,
      })
      .select("*")
      .single();
    if (error || !data) dbError(error, "Unable to create the assignment.");
    return response(request, data, 201);
  }
  const settingsRoute = path.match(/^\/assignments\/([0-9a-f-]+)\/settings$/i);
  if (request.method === "PUT" && settingsRoute) {
    const assignmentId = uuid(settingsRoute[1], "assignmentId");
    await requireAssignmentManager(context, assignmentId);
    const settings = validateSettings(await jsonBody(request));
    const { data, error } = await context.admin
      .from("settings")
      .upsert({
        assignment_id: assignmentId,
        weights: settings.weights as unknown as Json,
        fairness: {
          discountQuotes: settings.discountQuotes,
          discountReferences: settings.discountReferences,
          discountTemplates: settings.discountTemplates,
          threshold: settings.threshold,
        },
        updated_by: context.user.id,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error || !data) dbError(error, "Unable to save assignment settings.");
    return response(request, data);
  }
  throw new ApiError(404, "Route not found.", "not_found");
}

Deno.serve(async (request) => {
  try {
    assertOrigin(request);
    if (request.method === "OPTIONS")
      return new Response("ok", { headers: requestHeaders(request) });
    const context = await authenticate(request);
    return await handle(request, context);
  } catch (error) {
    if (error instanceof ApiError)
      return response(
        request,
        { error: error.message, code: error.code },
        error.status,
      );
    console.error(
      "Unhandled IntegrityLens API error",
      error instanceof Error ? error.name : "UnknownError",
    );
    return response(
      request,
      { error: "Internal server error.", code: "internal_error" },
      500,
    );
  }
});
