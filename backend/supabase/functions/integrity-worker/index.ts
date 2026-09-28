import { createClient } from "supabase";
import { analyzePair, pairs, templatePatterns } from "@integrity/engine";
import type { Document, Settings } from "@integrity/shared";
import { PRIVATE_BUCKET, uuid } from "../_shared/domain.ts";
import type { Database, Json } from "../_shared/database.types.ts";
import type { SupabaseClient } from "supabase";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BATCH_SIZE = 3;

function authorized(request: Request): boolean {
  const supplied = request.headers.get("apikey") ?? "";
  if (!SERVICE_ROLE_KEY || supplied.length !== SERVICE_ROLE_KEY.length)
    return false;
  let different = 0;
  for (let index = 0; index < supplied.length; index++)
    different |=
      supplied.charCodeAt(index) ^ SERVICE_ROLE_KEY.charCodeAt(index);
  return different === 0;
}

async function downloadText(
  admin: SupabaseClient<Database>,
  path: string,
): Promise<string> {
  const { data, error } = await admin.storage
    .from(PRIVATE_BUCKET)
    .download(path);
  if (error || !data)
    throw new Error("Unable to read an analysis document from private Storage.");
  return new TextDecoder("utf-8", { fatal: true }).decode(
    await data.arrayBuffer(),
  );
}

async function markFailed(
  admin: SupabaseClient<Database>,
  jobId: string,
  error: unknown,
) {
  console.error(
    "Analysis worker failed",
    jobId,
    error instanceof Error ? error.name : "UnknownError",
  );
  const { error: updateError } = await admin
    .from("analysis_jobs")
    .update({
      status: "failed",
      error_message: "Analysis failed. Contact an administrator with the job ID.",
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .in("status", ["queued", "running"]);
  if (updateError)
    console.error("Unable to mark analysis job failed", jobId, updateError.code ?? "unknown");
}

async function processBatch(jobId: string) {
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: job, error: jobError } = await admin
      .from("analysis_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    if (jobError || !job) throw new Error("Analysis job was not found.");
    if (["cancelled", "complete", "failed"].includes(job.status)) return;
    if (job.status === "queued") {
      const { error } = await admin
        .from("analysis_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("status", "queued");
      if (error) throw new Error("Unable to start the analysis job.");
    }
    const snapshot = (Array.isArray(job.document_snapshot)
      ? job.document_snapshot
      : []) as unknown as Array<Record<string, unknown>>;
    const ids = snapshot.map((entry) => String(entry.id));
    const { data: rows, error: documentError } = await admin
      .from("documents")
      .select("id,title,kind,storage_path,version,created_at")
      .in("id", ids);
    if (documentError || !rows || rows.length !== ids.length)
      throw new Error("An analysis document is unavailable.");
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const documents = await Promise.all(
      snapshot.map(async (entry): Promise<Document> => {
        const row = rowById.get(String(entry.id));
        if (!row || row.version !== Number(entry.version))
          throw new Error("A document changed after this job was queued.");
        return {
          id: row.id,
          title: row.title,
          author: "",
          kind: row.kind,
          text: await downloadText(admin, row.storage_path),
          createdAt: row.created_at,
        };
      }),
    );
    const work = pairs(documents);
    const templates = templatePatterns(documents);
    const start = Number(job.completed_pairs);
    const end = Math.min(start + BATCH_SIZE, work.length);
    for (let index = start; index < end; index++) {
      const { data: state, error: stateError } = await admin
        .from("analysis_jobs")
        .select("status")
        .eq("id", jobId)
        .single();
      if (stateError || !state) throw new Error("Unable to read analysis job state.");
      if (state?.status === "cancelled") return;
      const [left, right] = work[index];
      const measured = analyzePair(
        documents[left],
        documents[right],
        templates,
        job.settings as unknown as Settings,
      );
      const { data: existing } = await admin
        .from("analysis_results")
        .select("id")
        .eq("job_id", jobId)
        .eq("document_a", measured.a)
        .eq("document_b", measured.b)
        .maybeSingle();
      if (!existing) {
        const { data: result, error: resultError } = await admin
          .from("analysis_results")
          .insert({
            job_id: jobId,
            document_a: measured.a,
            document_b: measured.b,
            score: measured.score,
            components: measured.components as unknown as Json,
            exclusions_a: measured.exclusionsA as unknown as Json,
            exclusions_b: measured.exclusionsB as unknown as Json,
            truncated: measured.truncated,
          })
          .select("id")
          .single();
        if (resultError || !result)
          throw new Error(
            resultError?.message ?? "Unable to store the result.",
          );
        if (measured.matches.length) {
          const { error: matchError } = await admin.from("matches").insert(
            measured.matches.map((match) => ({
              result_id: result.id,
              kind: match.kind,
              a_start: match.aStart,
              a_end: match.aEnd,
              b_start: match.bStart,
              b_end: match.bEnd,
              similarity: match.similarity,
              excluded: match.excluded,
              reasons: match.reasons as unknown as Json,
            })),
          );
          if (matchError) throw new Error(matchError.message);
        }
      }
      const { error: progressError } = await admin
        .from("analysis_jobs")
        .update({ completed_pairs: index + 1 })
        .eq("id", jobId)
        .eq("status", "running");
      if (progressError) throw new Error("Unable to save analysis progress.");
    }
    if (end >= work.length) {
      const { error: completeError } = await admin
        .from("analysis_jobs")
        .update({ status: "complete", completed_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("status", "running");
      if (completeError) throw new Error("Unable to complete the analysis job.");
      return;
    }
    EdgeRuntime.waitUntil(
      fetch(`${SUPABASE_URL}/functions/v1/integrity-worker`, {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId }),
      }).then(async (response) => {
        if (!response.ok)
          await markFailed(
            admin,
            jobId,
            new Error(`Worker continuation returned ${response.status}.`),
          );
      }).catch((error) => markFailed(admin, jobId, error)),
    );
  } catch (error) {
    await markFailed(admin, jobId, error);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  if (!authorized(request))
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const jobId = uuid(body.jobId, "jobId");
    EdgeRuntime.waitUntil(processBatch(jobId));
    return Response.json({ accepted: true, jobId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request.";
    return Response.json({ error: message }, { status: 400 });
  }
});
