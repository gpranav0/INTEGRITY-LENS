import { useEffect, useState } from "react";
import { Fingerprint, LogOut, Upload } from "lucide-react";
import type { Document as IntegrityDocument, ReviewCase } from "@integrity/shared";
import type { HostedProfile } from "./HostedSession";
import {
  configuredSupabaseBackend,
  configuredSupabaseClient,
  type HostedCaseDetail,
  type HostedCaseSummary,
} from "./supabase";
import { publicConfiguration } from "./config";

export function HostedRoleWorkspace({ profile, signOut }: {
  profile: HostedProfile;
  signOut: () => Promise<void>;
}) {
  return <div className="role-workspace">
    <header className="role-header">
      <div className="brand"><span className="brand-mark"><Fingerprint size={25} /></span><span>IntegrityLens</span></div>
      <div><strong>{profile.displayName}</strong> · {profile.role} <button className="sign-out" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button></div>
    </header>
    {profile.role === "reviewer" ? <ReviewerWorkspace /> : <StudentWorkspace profile={profile} />}
  </div>;
}

function ReviewerWorkspace() {
  const backend = configuredSupabaseBackend();
  const [cases, setCases] = useState<HostedCaseSummary[]>([]);
  const [selected, setSelected] = useState<HostedCaseDetail | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ReviewCase["status"]>("Under review");
  const [message, setMessage] = useState("Loading assigned cases…");
  async function reload() {
    try { setCases(await backend.listCases()); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load cases."); }
  }
  useEffect(() => { void reload(); }, []);
  async function open(id: string) {
    setMessage("Loading blind-review evidence…");
    try { setSelected(await backend.caseEvidence(id)); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load evidence."); }
  }
  return <main className="role-main" id="main">
    <section><p className="eyebrow">REVIEWER WORKSPACE</p><h1>Assigned review cases</h1><p>Author identities are hidden. Similarity evidence supports your judgment; it does not establish misconduct.</p></section>
    {message && <p role="status">{message}</p>}
    <div className="role-grid"><section className="card padded"><h2>Cases</h2>{cases.length === 0 && !message ? <p>No cases are assigned to you.</p> : cases.map((item) => <button className="role-list-item" key={item.id} onClick={() => void open(item.id)}><span>Case {item.id.slice(0, 8)}</span><strong>{item.status}</strong></button>)}</section>
    <section className="card padded">{!selected ? <><h2>Evidence</h2><p>Select a case to inspect its passages and history.</p></> : <><h2>Blind-review evidence</h2><p><strong>Similarity score:</strong> {selected.result.score.toFixed(1)}%</p>{selected.documents.map((document) => <article key={document.id}><h3>{document.title}</h3><pre className="document-preview">{document.text}</pre></article>)}<h3>Case history</h3>{selected.review.events.map((event) => <p key={event.at}><strong>{event.role}</strong> · {new Date(event.at).toLocaleString()}<br />{event.text}</p>)}<form onSubmit={async (event) => { event.preventDefault(); if (!note.trim()) return; try { await backend.addCaseNote(selected.review.id, note); setNote(""); await open(selected.review.id); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to add note."); } }}><label>Review note<textarea required value={note} onChange={(event) => setNote(event.target.value)} /></label><button type="submit">Add note</button></form><form onSubmit={async (event) => { event.preventDefault(); if (!note.trim()) { setMessage("Enter a justification before changing status."); return; } try { await backend.transitionCase(selected.review.id, status, note); setNote(""); await Promise.all([open(selected.review.id), reload()]); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update status."); } }}><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as ReviewCase["status"])}><option>Under review</option><option>Needs discussion</option><option>Resolved</option><option>Closed</option></select></label><button type="submit">Update with justification</button></form></>}</section></div>
  </main>;
}

type StudentRow = { id: string; identifier: string; title: string; kind: string; byte_size: number; created_at: string };
function StudentWorkspace({ profile }: { profile: HostedProfile }) {
  const backend = configuredSupabaseBackend();
  const [documents, setDocuments] = useState<StudentRow[]>([]);
  const [message, setMessage] = useState("Loading your submissions…");
  async function reload() {
    const { data, error } = await configuredSupabaseClient().from("documents").select("id,identifier,title,kind,byte_size,created_at").eq("assignment_id", publicConfiguration.assignmentId).eq("owner_id", profile.id).order("created_at", { ascending: false });
    if (error) setMessage(error.message); else { setDocuments((data ?? []) as StudentRow[]); setMessage(""); }
  }
  useEffect(() => { void reload(); }, []);
  async function submit(file: File) {
    if (file.size > 20_000) { setMessage("The file must be 20 KB or smaller."); return; }
    const text = await file.text();
    const document: IntegrityDocument = { id: crypto.randomUUID(), title: file.name, author: profile.displayName, kind: "submission", text, createdAt: new Date().toISOString() };
    try { setMessage("Uploading submission…"); await backend.importDocument(publicConfiguration.assignmentId, document); await reload(); setMessage("Submission uploaded."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to upload submission."); }
  }
  return <main className="role-main" id="main"><section><p className="eyebrow">STUDENT WORKSPACE</p><h1>Your submissions</h1><p>Only files owned by your account are shown.</p></section><section className="card padded"><label className="upload-zone"><Upload size={24} /><strong>Upload a text or HTML submission</strong><input type="file" accept=".txt,.html,text/plain,text/html" onChange={(event) => { const file = event.target.files?.[0]; if (file) void submit(file); event.currentTarget.value = ""; }} /></label>{message && <p role="status">{message}</p>}<div>{documents.map((document) => <article className="role-document" key={document.id}><div><strong>{document.title}</strong><small>{new Date(document.created_at).toLocaleString()} · {document.byte_size} bytes</small></div><button onClick={async () => { try { const value = await backend.documentDownload(document.id); window.open(value.downloadUrl, "_blank", "noopener,noreferrer"); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to download file."); } }}>Download</button></article>)}</div></section></main>;
}
