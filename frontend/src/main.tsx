import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  LayoutDashboard,
  Files,
  ScanLine,
  Network,
  FlaskConical,
  Settings as SettingsIcon,
  CircleHelp,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  ChevronRight,
  Menu,
  X,
  ShieldCheck,
  Fingerprint,
  FileText,
  CircleCheck,
  Clock3,
  Download,
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  Eye,
  Info,
  Check,
  Sun,
  Moon,
  Monitor,
  Printer,
  SlidersHorizontal,
  BookOpen,
  MessageSquare,
  FolderCheck,
  Upload,
  Sparkles,
  LogOut,
} from "lucide-react";
import cytoscape from "cytoscape";
import { defaultSettings } from "@integrity/shared";
import type {
  Document as Doc,
  Settings,
  Snapshot,
  ReviewCase,
  CaseStatus,
} from "@integrity/shared";
import {
  rankResults,
  resultGraph,
  components,
  minimumSpanningForest,
  dijkstra,
  lcs,
  words,
  runLab,
} from "@integrity/engine";
import { demoDocuments } from "../demo-data/documents";
import { createRepository, validateDocument, readTextFile } from "./data";
import { publicConfiguration } from "./config";
import { configuredSupabaseBackend } from "./supabase";
import { HostedSession, type HostedProfile } from "./HostedSession";
import { HostedRoleWorkspace } from "./HostedRoleWorkspace";
import { reportHtml, downloadReport } from "./report";
import "./style.css";

const repository = createRepository();
const supabaseMode = publicConfiguration.mode === "supabase";
const initial: Snapshot = {
  documents: demoDocuments,
  results: [],
  cases: [],
  analyzedAt: null,
  analysisSettings: null,
};
const readPreference = <T,>(key: string, fallback: T): T => {
  try {
    return (
      JSON.parse(localStorage.getItem("integritylens:" + key) ?? "null") ??
      fallback
    );
  } catch {
    return fallback;
  }
};
type AppContext = {
  data: Snapshot;
  setData: React.Dispatch<React.SetStateAction<Snapshot>>;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  role: string;
  setRole: (v: string) => void;
  theme: string;
  setTheme: (v: string) => void;
  run: () => void;
  cancel: () => void;
  progress: { done: number; total: number } | null;
  notice: string;
  setNotice: (s: string) => void;
  reset: () => Promise<void>;
  refresh: () => Promise<void>;
  mode: "demo" | "supabase";
  profile: { displayName: string; role: string; email: string } | null;
  signOut: () => Promise<void>;
};
const Context = createContext<AppContext>(null!);
const useApp = () => useContext(Context);
const pct = (n: number) => n.toFixed(1);
const date = (s: string) =>
  new Date(s).toLocaleDateString("en", { month: "short", day: "numeric" });
function App({ hostedProfile = null, hostedSignOut = async () => {} }: {
  hostedProfile?: HostedProfile | null;
  hostedSignOut?: () => Promise<void>;
}) {
  const [data, setData] = useState<Snapshot>(initial),
    [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState(""),
    [settings, setSettings] = useState<Settings>(() =>
      readPreference("settings", defaultSettings),
    ),
    [role, setRole] = useState(() => readPreference("role", "Instructor")),
    [theme, setTheme] = useState(() => readPreference("theme", "light")),
    [progress, setProgress] = useState<{ done: number; total: number } | null>(
      null,
    ),
    [notice, setNotice] = useState("");
  const worker = useRef<Worker | null>(null);
  const backendJobId = useRef<string | null>(null);
  const saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    if (hostedProfile)
      setRole(hostedProfile.role.charAt(0).toUpperCase() + hostedProfile.role.slice(1));
  }, [hostedProfile]);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setLoadError("");
    repository
      .load()
      .then((s) => {
        if (!active) return;
        if (s) setData(s);
        setLoaded(true);
      })
      .catch((e) => {
        if (active) {
          setLoadError(e instanceof Error ? e.message : String(e));
          setLoaded(true);
        }
      });
    return () => {
      active = false;
      worker.current?.terminate();
      backendJobId.current = null;
    };
  }, []);
  useEffect(() => {
    if (loaded && !supabaseMode) {
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => repository.save(data))
        .catch((e) =>
          setNotice("Storage failed. Your changes are not saved: " + String(e)),
        );
    }
  }, [data, loaded]);
  useEffect(() => {
    try {
      localStorage.setItem("integritylens:settings", JSON.stringify(settings));
      if (!supabaseMode)
        localStorage.setItem("integritylens:role", JSON.stringify(role));
      localStorage.setItem("integritylens:theme", JSON.stringify(theme));
    } catch {
      setNotice("Preferences could not be saved.");
    }
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [settings, role, theme]);
  const refresh = async () => {
    const snapshot = await repository.load();
    if (snapshot) setData(snapshot);
  };
  const run = async () => {
    if (supabaseMode) {
      if (backendJobId.current) return;
      try {
        const backend = configuredSupabaseBackend();
        const job = await backend.startAnalysis(publicConfiguration.assignmentId, settings);
        backendJobId.current = job.id;
        setProgress({ done: job.completed_pairs, total: job.total_pairs });
        setNotice("Analysis job queued in the hosted workspace.");
        while (backendJobId.current === job.id) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          const current = await backend.analysisJob(job.id);
          setProgress({ done: current.completed_pairs, total: current.total_pairs });
          if (current.status === "complete") {
            const results = await backend.analysisResults(job.id);
            setData((value) => ({
              ...value,
              results,
              analyzedAt: current.completed_at ?? new Date().toISOString(),
              analysisSettings: structuredClone(settings),
            }));
            setNotice("Hosted analysis complete. Evidence and rankings are ready.");
            break;
          }
          if (current.status === "cancelled") {
            setNotice("Hosted analysis cancelled. Existing completed results are retained.");
            break;
          }
          if (current.status === "failed")
            throw new Error(current.error_message ?? "Hosted analysis failed.");
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Hosted analysis failed.");
      } finally {
        backendJobId.current = null;
        setProgress(null);
      }
      return;
    }
    if (worker.current) return;
    const currentSettings = structuredClone(settings);
    setNotice("");
    setProgress({ done: 0, total: 0 });
    const w = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.type === "progress")
        setProgress({ done: e.data.done, total: e.data.total });
      if (e.data.type === "complete") {
        setData((d) => ({
          ...d,
          results: e.data.results,
          analyzedAt: new Date().toISOString(),
          analysisSettings: currentSettings,
        }));
        setProgress(null);
        setNotice("Analysis complete. Evidence and rankings are ready.");
        w.terminate();
        worker.current = null;
      }
      if (e.data.type === "error") {
        setNotice(e.data.message);
        setProgress(null);
        w.terminate();
        worker.current = null;
      }
    };
    w.onerror = (e) => {
      setNotice("Analysis failed: " + e.message);
      setProgress(null);
      w.terminate();
      worker.current = null;
    };
    w.postMessage({ documents: data.documents, settings: currentSettings });
  };
  const cancel = async () => {
    if (supabaseMode && backendJobId.current) {
      const jobId = backendJobId.current;
      backendJobId.current = null;
      try {
        await configuredSupabaseBackend().cancelAnalysis(jobId);
        setNotice("Hosted analysis cancellation requested.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to cancel hosted analysis.");
      }
      setProgress(null);
      return;
    }
    worker.current?.terminate();
    worker.current = null;
    setProgress(null);
    setNotice("Analysis cancelled. Previously completed results are retained.");
  };
  const reset = async () => {
    if (supabaseMode) {
      setNotice("Hosted workspaces cannot be reset from the browser.");
      return;
    }
    cancel();
    await saveQueue.current;
    await repository.reset();
    setData(structuredClone(initial));
    setSettings(defaultSettings);
    setNotice("Local workspace reset to the fictional sample corpus.");
  };
  if (loadError)
    return (
      <main className="loading">
        <h1>Unable to open {supabaseMode ? "hosted" : "local"} workspace</h1>
        <p>{loadError}</p>
        <p>{supabaseMode ? "Confirm your assigned role, course access, assignment ID, and network connection." : "Allow IndexedDB storage for this site, then reload. No data has been overwritten."}</p>
        <button onClick={() => location.reload()}>Retry</button>
      </main>
    );
  if (!loaded)
    return (
      <main className="loading">
        <Fingerprint size={42} />
        <h1>Opening IntegrityLens</h1>
        <p>Reading this browser's local workspace…</p>
      </main>
    );
  return (
    <Context.Provider
      value={{
        data,
        setData,
        settings,
        setSettings,
        role,
        setRole,
        theme,
        setTheme,
        run,
        cancel,
        progress,
        notice,
        setNotice,
        reset,
        refresh,
        mode: publicConfiguration.mode,
        profile: hostedProfile && {
          displayName: hostedProfile.displayName,
          role: hostedProfile.role.charAt(0).toUpperCase() + hostedProfile.role.slice(1),
          email: hostedProfile.email,
        },
        signOut: hostedSignOut,
      }}
    >
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </Context.Provider>
  );
}

function ConfigurationError({ errors }: { errors: string[] }) {
  return (
    <main className="auth-page">
      <section className="auth-card" role="alert">
        <Fingerprint size={38} />
        <h1>Supabase configuration is incomplete</h1>
        <p>IntegrityLens has not contacted a backend. Correct these public build settings and rebuild the frontend:</p>
        <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        <p className="muted">Never place a service-role key, database password, access token, or signing secret in a VITE_ variable.</p>
      </section>
    </main>
  );
}

const nav = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/documents", label: "Documents", icon: Files },
  { to: "/analysis", label: "Similarity analysis", icon: ScanLine },
  { to: "/network", label: "Similarity network", icon: Network },
  { to: "/cases", label: "Review cases", icon: FolderCheck },
  { to: "/reports", label: "Reports", icon: FileText },
];
function Shell() {
  const { role, setRole, data, notice, setNotice, progress, mode, profile, signOut } = useApp(),
    [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => {
    if (!menu) return;
    const sidebar = document.querySelector<HTMLElement>(".sidebar");
    const focusable =
      sidebar?.querySelectorAll<HTMLElement>("a, button, select");
    focusable?.[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
      if (event.key === "Tab" && focusable?.length) {
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      document.querySelector<HTMLElement>(".mobile-menu")?.focus();
    };
  }, [menu]);
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const current =
    nav.find((n) => location.pathname.startsWith(n.to))?.label ??
    (location.pathname === "/lab"
      ? "Algorithm Lab"
      : location.pathname === "/settings"
        ? "Settings"
        : location.pathname === "/help"
          ? "Help & guidance"
          : location.pathname.startsWith("/evidence")
            ? "Evidence Explorer"
            : "Welcome");
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      {menu && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Fingerprint size={27} />
          </span>
          <span>
            Integrity<span className="brand-light">Lens</span>
            <small>EVIDENCE. CONTEXT. CLARITY.</small>
          </span>
        </Link>
        <div className="workspace-choice">
          <span className="workspace-avatar">W</span>
          <div>
            Westbridge University<small>Academic review workspace</small>
          </div>
          <span className="fictional-dot" title="Fictional institution" />
        </div>
        <p className="nav-heading">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to}>
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.to === "/cases" && data.cases.length > 0 && (
                <span className="nav-count">
                  {data.cases.filter((c) => c.status !== "Closed").length}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="nav-divider" />
        <p className="nav-heading">EXPLORE</p>
        <nav aria-label="Tools">
          <NavLink to="/lab">
            <FlaskConical size={18} />
            Algorithm Lab<span className="tiny-tag">LEARN</span>
          </NavLink>
          <NavLink to="/help">
            <CircleHelp size={18} />
            Help & guidance
          </NavLink>
          <NavLink to="/settings">
            <SettingsIcon size={18} />
            Settings
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="demo-card">
            <span className="status-dot" />
            <b>{mode === "demo" ? "Your local workspace" : "Hosted workspace"}</b>
            <p>
              {mode === "demo"
                ? "Explore with fictional documents. Your data stays in this browser."
                : "Access is enforced by Supabase Auth, RLS, and server-side authorization."}
            </p>
            <Link to="/help">
              {mode === "demo" ? "About demo mode" : "Security guidance"} <ArrowUpRight size={13} />
            </Link>
          </div>
          <div className="profile">
            <span className="profile-avatar">
              {mode === "demo" ? "DR" : profile?.displayName.slice(0, 2).toUpperCase() ?? "U"}
            </span>
            <div>
              <strong>{mode === "demo" ? "Demo reviewer" : profile?.displayName ?? "Loading profile…"}</strong>
              {mode === "demo" ? (
                <label className="role-label">
                  Demo role
                  <select aria-label="Demo role" value={role} onChange={(e) => setRole(e.target.value)}>
                    {["Instructor", "Reviewer", "Admin", "Student"].map((r) => <option key={r}>{r}</option>)}
                  </select>
                </label>
              ) : (
                <>
                  <small>{profile?.role ?? "Authenticated"}</small>
                  <button className="sign-out" onClick={() => void signOut()}><LogOut size={13} /> Sign out</button>
                </>
              )}
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{current}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="status-dot" />
              {mode === "demo" ? "Local demo" : "Hosted Supabase"}
            </span>
            <Link to="/help" className="icon-button" aria-label="Help">
              <CircleHelp size={19} />
            </Link>
            <span className="small-avatar">
              {mode === "demo" ? "DR" : profile?.displayName.slice(0, 2).toUpperCase() ?? "U"}
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="main-content">
          {notice && (
            <div className="notice" role="status">
              <Info size={17} />
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                className="icon-button"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {progress && (
            <div className="notice" role="status">
              <ScanLine size={18} />
              Analyzing {progress.done} of {progress.total} document pairs…{" "}
              <Link to="/analysis">View progress</Link>
            </div>
          )}
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/evidence/:id" element={<Evidence />} />
            <Route path="/network" element={<NetworkPage />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/lab" element={<Lab />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<Help />} />
            <Route
              path="*"
              element={
                <Empty
                  title="Page not found"
                  text="Return to your review workspace."
                  to="/dashboard"
                  action="Open overview"
                />
              }
            />
          </Routes>
          <footer>
            <span>
              <ShieldCheck size={14} /> Supporting judgment. Never replacing it.
            </span>
            <span>
              IntegrityLens <span className="footer-dot">·</span> Local demo
              v1.0
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Empty({
  title,
  text,
  to,
  action,
}: {
  title: string;
  text: string;
  to?: string;
  action?: string;
}) {
  return (
    <div className="empty">
      <ScanLine size={32} />
      <h2>{title}</h2>
      <p>{text}</p>
      {to && (
        <Link className="button primary" to={to}>
          {action}
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function LimitNote() {
  return (
    <div className="context-note">
      <ShieldCheck size={21} />
      <div>
        <strong>Similarity is a starting point, not a conclusion.</strong>
        <p>
          Textual overlap does not establish intent or authorship. Always
          consider quotations, citations, templates, and permitted
          collaboration. IntegrityLens does not detect AI-generated text.
        </p>
      </div>
    </div>
  );
}
function Landing() {
  return (
    <>
      <div className="landing-top">
        <Badge tone="teal">BUILT FOR THOUGHTFUL HUMAN REVIEW</Badge>
        <p className="landing-kicker">A clearer view of textual similarity.</p>
        <h1>
          Look beyond the score.
          <br />
          <span>Understand the evidence.</span>
        </h1>
        <p>
          Bring clarity and context to academic integrity review. Explore shared
          passages, understand how they match, and document a considered
          decision.
        </p>
        <div className="button-row">
          <Link to="/dashboard" className="button primary">
            Explore demo workspace <ArrowRight size={17} />
          </Link>
          <Link to="/lab" className="button">
            Open Algorithm Lab <FlaskConical size={17} />
          </Link>
        </div>
        <small>
          <span className="status-dot" /> No account needed · Fictional sample
          data · Runs in your browser
        </small>
      </div>
      <section className="card landing-evidence">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FROM SIGNAL TO UNDERSTANDING</span>
            <h2>Evidence you can actually inspect</h2>
          </div>
          <Badge tone="purple">Illustrative comparison</Badge>
        </div>
        <div className="comparison-preview">
          <div>
            <span className="doc-label">
              <FileText size={15} /> SUBMISSION · SUB-001
            </span>
            <h3>The social roots of urban gardens</h3>
            <p>
              <mark>
                Community gardens create shared spaces where residents exchange
                knowledge
              </mark>{" "}
              and build lasting relationships.
            </p>
          </div>
          <div>
            <span className="doc-label">
              <BookOpen size={15} /> REFERENCE · REF-001
            </span>
            <h3>Gardens and everyday cooperation</h3>
            <p>
              <mark>
                Community gardens create shared spaces where residents exchange
                knowledge
              </mark>{" "}
              and build lasting relationships.
            </p>
          </div>
        </div>
        <div className="preview-caption">
          <span className="legend-dot exact" />
          Shared wording in fictional sample documents. Run analysis to inspect
          measured evidence.
        </div>
      </section>
      <div className="feature-grid">
        {[
          {
            icon: ScanLine,
            title: "Trace every match",
            text: "Exact, shingle, and fuzzy matches link back to the original passages.",
          },
          {
            icon: SlidersHorizontal,
            title: "Make room for context",
            text: "Inspect quotation and template exclusions, then recompute with your chosen settings.",
          },
          {
            icon: MessageSquare,
            title: "Review with care",
            text: "Keep notes, discuss findings, and create a report with evidence and limitations.",
          },
        ].map((f) => (
          <div className="feature" key={f.title}>
            <f.icon size={23} />
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </div>
      <LimitNote />
    </>
  );
}
function Dashboard() {
  const { data, run, progress, settings } = useApp();
  const ranked = rankResults(data.results),
    flagged = ranked.filter((r) => r.score >= settings.threshold),
    open = data.cases.filter(
      (c) => c.status !== "Closed" && c.status !== "Resolved",
    );
  const activity = [
    ...data.documents.map((d) => ({
      at: d.createdAt,
      text: `${d.id} added to the document library`,
      type: "document",
    })),
    ...data.cases.flatMap((c) =>
      c.events.map((e) => ({ at: e.at, text: e.text, type: "review" })),
    ),
    ...(data.analyzedAt
      ? [
          {
            at: data.analyzedAt,
            text: `Analysis completed · ${data.results.length} document pairs`,
            type: "analysis",
          },
        ]
      : []),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 4);
  return (
    <>
      <PageHeading
        eyebrow="YOUR REVIEW WORKSPACE"
        title="A little clarity goes a long way."
        description="An overview of your documents, similarity evidence, and reviews."
      >
        <Link className="button" to="/documents">
          <Plus size={17} />
          Import documents
        </Link>
        <button className="primary" onClick={run} disabled={!!progress}>
          <ScanLine size={17} />
          {progress ? "Analyzing…" : "Run analysis"}
        </button>
      </PageHeading>
      <div className="workspace-banner">
        <div className="banner-symbol">
          <Sparkles size={23} />
        </div>
        <div>
          <strong>A safe space to explore the evidence.</strong>
          <p>
            You're viewing a local demo with fictional academic documents.
            Nothing is sent to a server.
          </p>
        </div>
        <Link to="/help?tour=1">
          Take a quick tour <ArrowRight size={16} />
        </Link>
      </div>
      <div className="stats-grid">
        {[
          {
            label: "Total documents",
            value: data.documents.length,
            icon: Files,
            detail: `${data.documents.filter((d) => d.kind === "submission").length} submissions · ${data.documents.filter((d) => d.kind === "reference").length} reference sources`,
            to: "/documents",
            tone: "teal",
          },
          {
            label: "Pairs analyzed",
            value: data.results.length,
            icon: ScanLine,
            detail: data.analyzedAt
              ? "Latest run " + date(data.analyzedAt)
              : "Ready for your first analysis",
            to: "/analysis",
            tone: "blue",
          },
          {
            label: "Above review threshold",
            value: flagged.length,
            icon: Eye,
            detail: `Similarity score ≥ ${settings.threshold} · context needed`,
            to: "/analysis",
            tone: "amber",
          },
          {
            label: "Open review cases",
            value: open.length,
            icon: FolderCheck,
            detail: `${data.cases.filter((c) => c.status === "Resolved" || c.status === "Closed").length} resolved or closed`,
            to: "/cases",
            tone: "purple",
          },
        ].map((s) => (
          <Link className="stat-card" to={s.to} key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={"stat-icon " + s.tone}>
                <s.icon size={18} />
              </span>
            </div>
            <strong>{s.value.toString().padStart(2, "0")}</strong>
            <div className="stat-detail">
              {s.detail}
              <ArrowUpRight size={15} />
            </div>
          </Link>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="card review-card">
          <div className="section-heading">
            <div>
              <h2>Ready for a closer look</h2>
              <p>Highest similarity scores in your latest analysis</p>
            </div>
            <Link to="/analysis" className="text-link">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {ranked.length ? (
            <>
              <div className="table-wrap">
                <table className="review-table">
                  <thead>
                    <tr>
                      <th>DOCUMENT PAIR</th>
                      <th>SIMILARITY</th>
                      <th>EVIDENCE</th>
                      <th aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.slice(0, 4).map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link
                            to={"/evidence/" + encodeURIComponent(r.id)}
                            className="pair-title"
                          >
                            {data.documents.find((d) => d.id === r.a)?.title}
                          </Link>
                          <small>
                            {r.a} <span>↔</span> {r.b}
                          </small>
                        </td>
                        <td>
                          <span className="score">
                            {pct(r.score)}
                            <small>/ 100</small>
                          </span>
                          <div className="score-track">
                            <span style={{ width: r.score + "%" }} />
                          </div>
                        </td>
                        <td>
                          <Badge
                            tone={
                              r.matches.some((m) => !m.excluded)
                                ? "amber"
                                : "neutral"
                            }
                          >
                            {r.matches.filter((m) => !m.excluded).length}{" "}
                            passages
                          </Badge>
                        </td>
                        <td>
                          <Link
                            className="icon-button"
                            aria-label={"Inspect " + r.id}
                            to={"/evidence/" + encodeURIComponent(r.id)}
                          >
                            <ChevronRight size={18} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-foot">
                <Info size={14} />
                Scores indicate textual similarity, never a finding of
                misconduct.
              </div>
            </>
          ) : (
            <div className="analysis-empty">
              <div className="empty-orbit">
                <ScanLine size={29} />
              </div>
              <h3>Your evidence starts here</h3>
              <p>
                Analyze the sample corpus to reveal actual document
                relationships and matched passages.
              </p>
              <button
                onClick={run}
                disabled={!!progress}
                className="primary small"
              >
                {progress ? "Analyzing…" : "Analyze demo documents"}
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </section>
        <section className="card activity-card">
          <div className="section-heading">
            <div>
              <h2>Recent activity</h2>
              <p>Your local workspace history</p>
            </div>
            <Clock3 size={18} />
          </div>
          <div className="activity-list">
            {activity.map((a, i) => (
              <div className="activity-item" key={i}>
                <span
                  className={
                    "activity-icon " + (a.type === "analysis" ? "teal" : "")
                  }
                >
                  {a.type === "analysis" ? (
                    <CircleCheck size={15} />
                  ) : a.type === "review" ? (
                    <MessageSquare size={15} />
                  ) : (
                    <FileText size={15} />
                  )}
                </span>
                <div>
                  <p>{a.text}</p>
                  <small>
                    {date(a.at)} ·{" "}
                    {new Date(a.at).toLocaleTimeString("en", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
              </div>
            ))}
          </div>
          <div className="card-foot">
            <span className="status-dot" />
            Stored on this device only
          </div>
        </section>
      </div>
      <div className="bottom-grid">
        <Link to="/lab" className="lab-promo">
          <div className="lab-promo-icon">
            <FlaskConical size={25} />
          </div>
          <div>
            <Badge tone="teal">ALGORITHM LAB</Badge>
            <h3>See how a match is made.</h3>
            <p>
              Step through the algorithms behind the evidence.
              <br />
              Real inputs. Real operations. No black box.
            </p>
            <span className="text-link">
              Explore the lab <ArrowRight size={15} />
            </span>
          </div>
          <div className="mini-code" aria-hidden="true">
            <span>text[i] === pattern[j]</span>
            <div>
              <b>A</b>
              <b>B</b>
              <b className="selected">A</b>
              <b>B</b>
              <b>A</b>
            </div>
            <small>
              i = 2 <span>→</span> match
            </small>
          </div>
        </Link>
        <div className="review-principle">
          <ShieldCheck size={24} />
          <div>
            <h3>Evidence first. People always.</h3>
            <p>
              Quotation, citation, and collaboration all need context.
              IntegrityLens supports a thoughtful human review.
            </p>
            <Link to="/help" className="text-link">
              Our review principles <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
function Documents() {
  const { data, setData, role, setNotice, progress, mode, refresh } = useApp();
  const [show, setShow] = useState(false),
    [id, setId] = useState(""),
    [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [kind, setKind] = useState<Doc["kind"]>("submission"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [fileResults, setFileResults] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Doc | null>(null);
  const add = async () => {
    try {
      if (data.documents.length >= 30)
        throw new Error("Local analysis is limited to 30 documents.");
      validateDocument({ id, title, text }, data.documents);
      const doc: Doc = {
        id: id.trim(),
        title: title.trim(),
        text,
        kind,
        author: "Local import",
        createdAt: new Date().toISOString(),
      };
      setBusy(true);
      if (mode === "supabase") {
        await configuredSupabaseBackend().importDocument(publicConfiguration.assignmentId, doc);
        await refresh();
      } else {
        setData((d) => ({
          ...d,
          documents: [...d.documents, doc],
          results: [],
          analyzedAt: null,
          analysisSettings: null,
        }));
      }
      setShow(false);
      setId("");
      setTitle("");
      setText("");
      setError("");
      setNotice(
        `Document imported ${mode === "supabase" ? "to the hosted assignment" : "locally"}. Run analysis to refresh evidence.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    const messages: string[] = [],
      added: Doc[] = [];
    for (const file of Array.from(files)) {
      try {
        if (data.documents.length + added.length >= 30)
          throw new Error("30-document limit reached.");
        const content = await readTextFile(file),
          docId = file.name.replace(/\.txt$/i, "");
        validateDocument({ id: docId, title: file.name, text: content }, [
          ...data.documents,
          ...added,
        ]);
        const document: Doc = {
          id: docId,
          title: docId,
          text: content,
          kind,
          author: "Local import",
          createdAt: new Date().toISOString(),
        };
        if (mode === "supabase")
          await configuredSupabaseBackend().importDocument(publicConfiguration.assignmentId, document);
        else added.push(document);
        messages.push(file.name + ": imported");
      } catch (e) {
        messages.push(file.name + ": " + (e as Error).message);
      }
    }
    if (added.length)
      setData((d) => ({
        ...d,
        documents: [...d.documents, ...added],
        results: [],
        analyzedAt: null,
        analysisSettings: null,
      }));
    if (mode === "supabase" && messages.some((message) => message.endsWith(": imported")))
      await refresh();
    setFileResults(messages);
    setBusy(false);
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR SOURCE MATERIAL"
        title="Document library"
        description="A clear home for submissions, reference material, and assignment templates."
      >
        <button
          className="primary"
          onClick={() => setShow(!show)}
          disabled={!!progress}
        >
          <Plus size={17} />
          {show ? "Close importer" : "Import documents"}
        </button>
      </PageHeading>
      <div className="info-line">
        <Info size={16} />
        Local UTF-8 text only · 20 KB and 1,200 words per document · 30
        documents per workspace
      </div>
      {show && (
        <section className="card padded">
          <div className="section-heading">
            <h2>Import documents</h2>
            <button
              className="icon-button"
              aria-label="Close importer"
              onClick={() => setShow(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="form-grid">
            <label>
              Identifier
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="e.g. SUB-006"
              />
            </label>
            <label>
              Document title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give this document a clear title"
              />
            </label>
            <label>
              Classification
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Doc["kind"])}
              >
                <option value="submission">Submission</option>
                <option value="reference">Reference source</option>
                <option value="template">Assignment template</option>
              </select>
            </label>
          </div>
          <label>
            Paste document text
            <textarea
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the text you want to review…"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button
              className="primary"
              onClick={add}
              disabled={!!progress || busy}
            >
              <Plus size={16} />
              Add pasted document
            </button>
            <label className="file-input button">
              <Upload size={16} />
              {busy ? "Importing…" : "Choose .txt files"}
              <input
                aria-label="Choose text files"
                type="file"
                accept=".txt,text/plain"
                multiple
                disabled={busy || !!progress}
                onChange={(e) => {
                  void importFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="muted">
            Files use their filename as the identifier and the selected
            classification. Each file is validated separately.
          </p>
          {fileResults.length > 0 && (
            <ul className="import-results" role="status">
              {fileResults.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="card">
        <div className="section-heading">
          <h2>
            All documents <span className="count">{data.documents.length}</span>
          </h2>
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search documents"
              placeholder="Search documents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>DOCUMENT</th>
                <th>TYPE</th>
                <th>{role === "Reviewer" ? "BLIND REVIEW" : "AUTHOR"}</th>
                <th>ADDED</th>
                <th>TEXT</th>
              </tr>
            </thead>
            <tbody>
              {data.documents
                .filter((d) =>
                  (d.title + " " + d.id)
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((d) => (
                  <tr key={d.id}>
                    <td>
                      <button
                        className="document-link"
                        onClick={() => setSelected(d)}
                      >
                        <span className="file-icon">
                          <FileText size={20} />
                        </span>
                        <span>
                          {d.title}
                          <small>{d.id}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <Badge
                        tone={
                          d.kind === "submission"
                            ? "blue"
                            : d.kind === "reference"
                              ? "teal"
                              : "purple"
                        }
                      >
                        {d.kind}
                      </Badge>
                    </td>
                    <td>{role === "Reviewer" ? "Author hidden" : d.author}</td>
                    <td>{date(d.createdAt)}</td>
                    <td>{words(d.text).length} words</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!data.documents.some((d) =>
          (d.title + " " + d.id).toLowerCase().includes(query.toLowerCase()),
        ) && (
          <Empty
            title="No documents found"
            text="Try a different search or import a document."
          />
        )}
      </section>
      {selected && (
        <Modal title={selected.title} close={() => setSelected(null)}>
          <p className="muted">
            {selected.id} · {selected.kind} ·{" "}
            {role === "Reviewer"
              ? "Author hidden for demo blind review"
              : selected.author}
          </p>
          <div className="document-body">{selected.text}</div>
        </Modal>
      )}
      <LimitNote />
    </>
  );
}
function ScoreFormula() {
  const { data, settings } = useApp();
  const s = data.analysisSettings ?? settings;
  return (
    <details className="formula">
      <summary>
        <SlidersHorizontal size={16} />
        How this score is calculated
      </summary>
      <p>
        Similarity score = ({s.weights.exact} × exact coverage +{" "}
        {s.weights.shingle} × shingle coverage + {s.weights.fuzzy} × fuzzy
        coverage) ÷ {s.weights.exact + s.weights.shingle + s.weights.fuzzy}.
      </p>
      <p>
        Each component averages matched token coverage across both documents;
        non-exact coverage is weighted by passage LCS similarity. Each token
        counts at most once within a component. A passage overlapping an enabled
        exclusion is discounted in full. Scores are lexical signals, not
        calibrated probabilities.
      </p>
      <p>
        KMP finds normalized exact passages. Shingle matches share 3-word
        sequences (Jaccard ≥ 0.24); fuzzy matches have token LCS similarity ≥
        0.50. These thresholds do not establish semantic equivalence.
      </p>
      <p>
        At most 60 passages per document, 128 tokens per fuzzy passage, and 80
        matches per pair.{" "}
        <Link to="/settings">Adjust weights and fairness options</Link>.
      </p>
    </details>
  );
}
function Analysis() {
  const { data, run, cancel, progress, settings } = useApp(),
    [query, setQuery] = useState(""),
    [ascending, setAscending] = useState(false);
  const results = rankResults(data.results, query, ascending);
  const stale =
    data.analysisSettings &&
    JSON.stringify(data.analysisSettings) !== JSON.stringify(settings);
  return (
    <>
      <PageHeading
        eyebrow="FOLLOW THE EVIDENCE"
        title="Similarity analysis"
        description="Compare document pairs with transparent, reproducible lexical measurements."
      >
        <button
          className="primary"
          onClick={run}
          disabled={!!progress || data.documents.length < 2}
        >
          <Play size={16} />
          {progress ? "Analyzing…" : "Run analysis"}
        </button>
      </PageHeading>
      {progress && (
        <section className="card padded">
          <div className="section-heading">
            <h2>Comparing document pairs</h2>
            <button onClick={cancel}>Cancel analysis</button>
          </div>
          <progress value={progress.done} max={progress.total || 1} />
          <p aria-live="polite">
            {progress.done} / {progress.total} pairs completed. Progress
            reflects completed engine work.
          </p>
        </section>
      )}
      {stale && (
        <div className="notice">
          <Info size={18} />
          Settings have changed. Run analysis to apply them; the results below
          retain their original settings.
        </div>
      )}
      <ScoreFormula />
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>
              Ranked results <span className="count">{results.length}</span>
            </h2>
            <p>
              {data.analyzedAt
                ? "Analyzed " + new Date(data.analyzedAt).toLocaleString()
                : "No analysis has been run yet."}
            </p>
          </div>
          <div className="button-row">
            <label className="search-field">
              <Search size={16} />
              <input
                placeholder="Search document IDs…"
                aria-label="Search results"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Sort results"
              value={ascending ? "asc" : "desc"}
              onChange={(e) => setAscending(e.target.value === "asc")}
            >
              <option value="desc">Highest score first</option>
              <option value="asc">Lowest score first</option>
            </select>
          </div>
        </div>
        {results.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>DOCUMENT PAIR</th>
                  <th>SIMILARITY SCORE</th>
                  <th>EXACT</th>
                  <th>SHINGLE</th>
                  <th>FUZZY</th>
                  <th>EVIDENCE</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        className="pair-title"
                        to={"/evidence/" + encodeURIComponent(r.id)}
                      >
                        {r.a} <span className="muted">↔</span> {r.b}
                      </Link>
                      <small>
                        {data.documents.find((d) => d.id === r.a)?.title}
                      </small>
                    </td>
                    <td>
                      <strong className="score">
                        {pct(r.score)}
                        <small>/100</small>
                      </strong>
                      {r.truncated && (
                        <small className="warning">Evidence truncated</small>
                      )}
                    </td>
                    <td>{pct(r.components.exact)}</td>
                    <td>{pct(r.components.shingle)}</td>
                    <td>{pct(r.components.fuzzy)}</td>
                    <td>
                      {r.matches.filter((m) => !m.excluded).length} included
                      <small>
                        {r.matches.filter((m) => m.excluded).length} excluded
                      </small>
                    </td>
                    <td>
                      <Link
                        className="text-link"
                        to={"/evidence/" + encodeURIComponent(r.id)}
                      >
                        Inspect <ArrowUpRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              data.analyzedAt ? "No matching results" : "Ready when you are"
            }
            text={
              data.analyzedAt
                ? "Try a different document identifier."
                : "Run analysis to compare the documents in your library. No scores are pre-generated."
            }
          />
        )}
      </section>
      <LimitNote />
    </>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="section-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Evidence() {
  const { id } = useParams(),
    { data, setData, role, setNotice, mode, refresh } = useApp(),
    navigate = useNavigate();
  const result = data.results.find((r) => r.id === id);
  const [visible, setVisible] = useState({
      exact: true,
      shingle: true,
      fuzzy: true,
      excluded: true,
    }),
    [active, setActive] = useState(0),
    [sync, setSync] = useState(true);
  const left = useRef<HTMLDivElement>(null),
    right = useRef<HTMLDivElement>(null),
    scrollLock = useRef(false);
  const matches =
    result?.matches.filter((m) =>
      m.excluded ? visible.excluded : visible[m.kind],
    ) ?? [];
  const current = matches[active];
  const focusMatch = (index: number) => {
    const next = Math.max(0, Math.min(index, matches.length - 1));
    setActive(next);
    const m = matches[next];
    if (m) {
      document
        .getElementById("left-" + m.id)
        ?.scrollIntoView({ block: "center", behavior: "instant" });
      document
        .getElementById("right-" + m.id)
        ?.scrollIntoView({ block: "center", behavior: "instant" });
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input,textarea,select,button")) return;
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        focusMatch(active + 1);
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        focusMatch(active - 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!result)
    return (
      <Empty
        title="Evidence is not available"
        text="Run analysis to generate this document pair. Importing documents invalidates earlier results."
        to="/analysis"
        action="Open analysis"
      />
    );
  const a = data.documents.find((d) => d.id === result.a)!,
    b = data.documents.find((d) => d.id === result.b)!;
  const openCase = async () => {
    const existing = data.cases.find((c) => c.resultId === result.id);
    if (!existing) {
      if (mode === "supabase") {
        try {
          await configuredSupabaseBackend().openCase(result.id);
          await refresh();
          setNotice("Review case opened in the hosted workspace. No finding of misconduct has been made.");
          navigate("/cases");
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Unable to open the hosted case.");
        }
        return;
      }
      const review: ReviewCase = {
        id: "CASE-" + crypto.randomUUID().slice(0, 8),
        resultId: result.id,
        status: "New",
        events: [
          {
            at: new Date().toISOString(),
            role,
            text: "Case opened for contextual human review.",
          },
        ],
      };
      setData((d) => ({ ...d, cases: [...d.cases, review] }));
      setNotice("Review case opened. No finding of misconduct has been made.");
    }
    navigate("/cases");
  };
  const scroll = (
    from: React.RefObject<HTMLDivElement | null>,
    to: React.RefObject<HTMLDivElement | null>,
  ) => {
    if (!sync || scrollLock.current || !from.current || !to.current) return;
    scrollLock.current = true;
    const range = from.current.scrollHeight - from.current.clientHeight;
    to.current.scrollTop = range
      ? (from.current.scrollTop / range) *
        (to.current.scrollHeight - to.current.clientHeight)
      : 0;
    requestAnimationFrame(() => {
      scrollLock.current = false;
    });
  };
  const highlighted = (text: string, side: "a" | "b") => {
    const spans = matches
      .map((m, i) => ({
        m,
        i,
        start: side === "a" ? m.aStart : m.bStart,
        end: side === "a" ? m.aEnd : m.bEnd,
      }))
      .sort((x, y) => x.start - y.start);
    const nodes: React.ReactNode[] = [];
    let offset = 0;
    for (const s of spans) {
      if (s.start < offset) continue;
      nodes.push(text.slice(offset, s.start));
      nodes.push(
        <mark
          key={s.m.id}
          role="button"
          tabIndex={0}
          id={(side === "a" ? "left-" : "right-") + s.m.id}
          className={
            "passage " +
            (s.m.excluded ? "excluded" : s.m.kind) +
            (s.i === active ? " selected-passage" : "")
          }
          onClick={() => focusMatch(s.i)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              focusMatch(s.i);
            }
          }}
          aria-label={`${s.m.excluded ? "Excluded " : ""}${s.m.kind} passage ${s.i + 1}`}
        >
          {text.slice(s.start, s.end)}
        </mark>,
      );
      offset = s.end;
    }
    nodes.push(text.slice(offset));
    return nodes;
  };
  const alignment = current
    ? lcs(
        words(a.text.slice(current.aStart, current.aEnd)).slice(0, 256),
        words(b.text.slice(current.bStart, current.bEnd)).slice(0, 256),
      ).alignment
    : [];
  return (
    <>
      <PageHeading
        eyebrow="PASSAGE-LEVEL EVIDENCE"
        title="Evidence Explorer"
        description={`${a.id} ↔ ${b.id} · Side-by-side context for a considered review.`}
      >
        <button onClick={() => window.print()}>
          <Printer size={16} />
          Print
        </button>
        <button className="primary" onClick={openCase}>
          <FolderCheck size={17} />
          Open review case
        </button>
      </PageHeading>
      <div className="evidence-summary card">
        <div>
          <span className="eyebrow">SIMILARITY SCORE</span>
          <strong>
            {pct(result.score)}
            <small>/100</small>
          </strong>
        </div>
        <div>
          <span className="eyebrow">COMPONENT COVERAGE</span>
          <p>
            <span className="legend-dot exact" />
            Exact {pct(result.components.exact)}{" "}
            <span className="legend-dot shingle" />
            Shingle {pct(result.components.shingle)}{" "}
            <span className="legend-dot fuzzy" />
            Fuzzy {pct(result.components.fuzzy)}
          </p>
        </div>
        <div>
          <span className="eyebrow">PASSAGE EVIDENCE</span>
          <p>
            {result.matches.length} matches ·{" "}
            {result.matches.filter((m) => m.excluded).length} discounted
          </p>
        </div>
      </div>
      <div className="evidence-toolbar">
        <div className="legend">
          {(["exact", "shingle", "fuzzy", "excluded"] as const).map((k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={visible[k]}
                onChange={(e) => {
                  setVisible({ ...visible, [k]: e.target.checked });
                  setActive(0);
                }}
              />
              <span className={"legend-dot " + k} />
              {k}
            </label>
          ))}
        </div>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={sync}
            onChange={(e) => setSync(e.target.checked)}
          />
          Sync scrolling
        </label>
      </div>
      <div className="evidence-columns">
        {[a, b].map((d, i) => (
          <section className="card evidence-document" key={d.id}>
            <div className="document-heading">
              <Badge tone={i ? "teal" : "blue"}>
                {d.kind} · {d.id}
              </Badge>
              <h2>{d.title}</h2>
              <p>
                {role === "Reviewer"
                  ? "Author hidden · blind review demo"
                  : d.author}{" "}
                · {date(d.createdAt)}
              </p>
            </div>
            <div className="document-reader">
              <div
                className="document-body"
                tabIndex={0}
                aria-label={i ? "Source text" : "Submission text"}
                ref={i ? right : left}
                onScroll={() => scroll(i ? right : left, i ? left : right)}
              >
                {highlighted(d.text, i ? "b" : "a")}
              </div>
              <div className="minimap" aria-label={`${d.id} passage minimap`}>
                {matches.map((m, j) => (
                  <button
                    key={m.id}
                    aria-label={`Jump to passage ${j + 1} in ${d.id}`}
                    className={
                      (m.excluded ? "excluded" : m.kind) +
                      (j === active ? " current" : "")
                    }
                    style={{
                      top:
                        ((i ? m.bStart : m.aStart) / d.text.length) * 94 + "%",
                      height:
                        Math.max(
                          2,
                          ((i ? m.bEnd - m.bStart : m.aEnd - m.aStart) /
                            d.text.length) *
                            94,
                        ) + "%",
                    }}
                    onClick={() => focusMatch(j)}
                  />
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
      <section className="card padded">
        <div className="section-heading">
          <div>
            <h2>
              {current
                ? `Passage ${active + 1} of ${matches.length}`
                : "No visible passages"}
            </h2>
            <p>
              Use J / K to move between passages. Select a highlighted passage
              to link its counterpart.
            </p>
          </div>
          <div className="button-row">
            <button
              aria-label="Previous passage"
              disabled={active <= 0 || !matches.length}
              onClick={() => focusMatch(active - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              aria-label="Next passage"
              disabled={active >= matches.length - 1 || !matches.length}
              onClick={() => focusMatch(active + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        {current && (
          <>
            <div className="button-row">
              <Badge tone={current.excluded ? "neutral" : "teal"}>
                {current.kind === "exact"
                  ? "KMP exact match"
                  : current.kind === "shingle"
                    ? "3-word shingles + LCS"
                    : "Token LCS alignment"}
              </Badge>
              <span>{pct(current.similarity * 100)}% passage similarity</span>
              <span className="muted">
                Characters {current.aStart}–{current.aEnd} ↔ {current.bStart}–
                {current.bEnd}
              </span>
            </div>
            {current.excluded && (
              <p className="warning">
                Excluded from score: {current.reasons.join(", ")}. An
                overlapping exclusion discounts the full passage.
              </p>
            )}
            <h3>Word-level alignment</h3>
            <p className="muted">
              Normalized tokens · <del>left-only tokens</del> ·{" "}
              <ins>right-only tokens</ins>
            </p>
            <div className="word-diff">
              {alignment.map((w, i) => (
                <React.Fragment key={i}>
                  {w.equal ? (
                    <span>{w.a} </span>
                  ) : w.a ? (
                    <del>{w.a} </del>
                  ) : (
                    <ins>{w.b} </ins>
                  )}
                </React.Fragment>
              ))}
            </div>
            {(words(a.text.slice(current.aStart, current.aEnd)).length > 256 ||
              words(b.text.slice(current.bStart, current.bEnd)).length >
                256) && (
              <p className="warning">
                Alignment limited to the first 256 tokens per side.
              </p>
            )}
          </>
        )}
      </section>
      <details className="card padded">
        <summary>
          All detected exclusions (
          {result.exclusionsA.length + result.exclusionsB.length})
        </summary>
        {[
          ...result.exclusionsA.map((e) => ({ ...e, doc: a })),
          ...result.exclusionsB.map((e) => ({ ...e, doc: b })),
        ].map((e, i) => (
          <div className="exclusion-item" key={i}>
            <Badge>{e.reason}</Badge>
            <b>
              {e.doc.id} · characters {e.start}–{e.end}
            </b>
            <p>{e.doc.text.slice(e.start, e.end)}</p>
          </div>
        ))}
        {!result.exclusionsA.length && !result.exclusionsB.length && (
          <p>No quotation, reference-heading, or template spans detected.</p>
        )}
        <Link to="/settings">Change exclusion discounts</Link>
      </details>
      {result.truncated && (
        <p className="warning">
          Evidence is truncated by analysis limits. Inspect the full documents
          for context.
        </p>
      )}
      <ScoreFormula />
      <LimitNote />
    </>
  );
}
function NetworkPage() {
  const { data, settings, role } = useApp(),
    [forest, setForest] = useState(false),
    [threshold, setThreshold] = useState(settings.threshold),
    [from, setFrom] = useState("0"),
    [to, setTo] = useState("1"),
    [selected, setSelected] = useState<Doc | null>(null);
  const ref = useRef<HTMLDivElement>(null),
    edges = useMemo(
      () => resultGraph(data.documents, data.results, threshold),
      [data, threshold],
    ),
    groups = useMemo(
      () => components(data.documents.length, edges),
      [data.documents.length, edges],
    ),
    path = useMemo(
      () => dijkstra(data.documents.length, edges, Number(from), Number(to)),
      [data.documents.length, edges, from, to],
    );
  useEffect(() => {
    if (!ref.current) return;
    const shown = forest
      ? minimumSpanningForest(data.documents.length, edges)
      : edges;
    const cy = cytoscape({
      container: ref.current,
      elements: [
        ...data.documents.map((d, i) => ({
          data: { id: String(i), label: d.id, kind: d.kind },
        })),
        ...shown.map((e, i) => ({
          data: {
            id: "e" + i,
            source: String(e.from),
            target: String(e.to),
            label: pct(101 - e.weight),
            path: path.path.some(
              (p, j) =>
                j > 0 &&
                ((path.path[j - 1] === e.from && p === e.to) ||
                  (path.path[j - 1] === e.to && p === e.from)),
            )
              ? "yes"
              : "no",
          },
        })),
      ],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#27887e",
            label: "data(label)",
            color: "#4a6270",
            "font-size": 12,
            "text-valign": "bottom",
            "text-margin-y": 12,
            width: 42,
            height: 42,
            "border-width": 5,
            "border-color": "#dcece8",
          },
        },
        {
          selector: 'node[kind="reference"]',
          style: { "background-color": "#7486bd", "border-color": "#e2e6f1" },
        },
        {
          selector: 'node[kind="template"]',
          style: { "background-color": "#b39870", "border-color": "#f0e8da" },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#b7c9c6",
            label: "data(label)",
            "font-size": 10,
            color: "#586d74",
            "text-background-color": "#f7f8fa",
            "text-background-opacity": 1,
            "text-background-padding": "4px",
            "curve-style": "bezier",
          },
        },
        {
          selector: 'edge[path="yes"]',
          style: { "line-color": "#23877c", width: 4 },
        },
      ],
      layout: { name: "circle", padding: 70 },
      minZoom: 0.5,
      maxZoom: 2,
      wheelSensitivity: 0.15,
    });
    cy.on("tap", "node", (e) =>
      setSelected(data.documents[Number(e.target.id())]),
    );
    return () => cy.destroy();
  }, [data.documents, edges, forest, path]);
  return (
    <>
      <PageHeading
        eyebrow="CONNECTIONS IN CONTEXT"
        title="Similarity network"
        description="Explore relationships supported by your actual document-pair results."
      />
      <div className="network-layout">
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Document relationships</h2>
              <p>
                {edges.length} edges · {groups.length} connected components
              </p>
            </div>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={forest}
                onChange={(e) => setForest(e.target.checked)}
              />
              Minimum spanning forest
            </label>
          </div>
          <div
            className="graph"
            ref={ref}
            role="img"
            aria-label={`Similarity network: ${data.documents.length} documents and ${edges.length} edges`}
          />
          <div className="card-foot">
            Select a node to inspect it. Edge labels show similarity scores, not
            copying direction.
          </div>
        </section>
        <aside className="card padded">
          <h2>Explore connections</h2>
          <label>
            Minimum similarity: {threshold}
            <input
              type="range"
              min="0"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
          <h3>Shortest path</h3>
          <label>
            From
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {data.documents.map((d, i) => (
                <option key={d.id} value={i}>
                  {d.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            To
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {data.documents.map((d, i) => (
                <option key={d.id} value={i}>
                  {d.id}
                </option>
              ))}
            </select>
          </label>
          <div className="path-result">
            {path.path.length
              ? path.path.map((i) => data.documents[i].id).join(" ? ")
              : "No connecting path at this threshold."}
          </div>
          <p className="muted">
            Distance = 101 - similarity. The forest retains the strongest
            connecting links. Paths use the full thresholded network.
          </p>
          <h3>Connected components</h3>
          {groups.map((g, i) => (
            <p className="component-group" key={i}>
              <b>{i + 1}</b>
              {g.map((j) => data.documents[j].id).join(", ")}
            </p>
          ))}
        </aside>
      </div>
      <details className="card padded">
        <summary>Accessible relationship list</summary>
        {edges.length ? (
          edges.map((e, i) => (
            <p key={i}>
              <Link
                to={
                  "/evidence/" +
                  encodeURIComponent(
                    data.results.find(
                      (r) =>
                        (r.a === data.documents[e.from].id &&
                          r.b === data.documents[e.to].id) ||
                        (r.b === data.documents[e.from].id &&
                          r.a === data.documents[e.to].id),
                    )!.id,
                  )
                }
              >
                {data.documents[e.from].id} ? {data.documents[e.to].id}
              </Link>{" "}
              · {pct(101 - e.weight)}
            </p>
          ))
        ) : (
          <p>
            No links meet this threshold. Run analysis or lower the threshold.
          </p>
        )}
        {data.documents.map((d) => (
          <button className="small" key={d.id} onClick={() => setSelected(d)}>
            Inspect {d.id}
          </button>
        ))}
      </details>
      {selected && (
        <Modal title={selected.title} close={() => setSelected(null)}>
          <p>
            {selected.id} · {selected.kind} ·{" "}
            {role === "Reviewer" ? "Author hidden" : selected.author}
          </p>
          <p className="muted">
            Imported {new Date(selected.createdAt).toLocaleString()}. Timestamps
            provide context and do not prove copying direction.
          </p>
          <div className="document-body">{selected.text}</div>
        </Modal>
      )}
      <LimitNote />
    </>
  );
}
const statuses: CaseStatus[] = [
  "New",
  "Under review",
  "Needs discussion",
  "Resolved",
  "Closed",
];
function Cases() {
  const { data, setData, role, setNotice, mode, refresh } = useApp(),
    [selected, setSelected] = useState(""),
    [note, setNote] = useState(""),
    [error, setError] = useState("");
  const review = data.cases.find((c) => c.id === selected) ?? data.cases[0];
  const index = review ? statuses.indexOf(review.status) : 0;
  const addEvent = async (next?: CaseStatus) => {
    if (!review) return;
    if (!note.trim()) {
      setError(
        next === "Resolved"
          ? "A justification is required to resolve this case."
          : "Add a note explaining this review action.",
      );
      return;
    }
    if (mode === "supabase") {
      try {
        if (next)
          await configuredSupabaseBackend().transitionCase(review.id, next, note.trim());
        else await configuredSupabaseBackend().addCaseNote(review.id, note.trim());
        await refresh();
        setNote("");
        setError("");
        setNotice(next ? `Case moved to ${next}.` : "Reviewer note saved to the hosted audit history.");
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to update the hosted case.");
      }
      return;
    }
    const at = new Date().toISOString();
    setData((d) => ({
      ...d,
      cases: d.cases.map((c) =>
        c.id === review.id
          ? {
              ...c,
              status: next ?? c.status,
              events: [
                ...c.events,
                {
                  at,
                  role,
                  text:
                    (next ? `Status changed to ${next}. ` : "") + note.trim(),
                },
              ],
            }
          : c,
      ),
    }));
    setNote("");
    setError("");
    setNotice(
      next ? "Case moved to " + next + "." : "Reviewer note saved locally.",
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="CONSIDERED HUMAN JUDGMENT"
        title="Review cases"
        description="Record context, discuss evidence, and explain each decision."
      />
      <div className="info-line">
        <Eye size={17} />
        Reviewer mode hides author metadata. Demo roles are workflow
        illustrations, not security boundaries; local data remains inspectable.
      </div>
      {!review ? (
        <Empty
          title="No review cases yet"
          text="Open a document pair in Evidence Explorer to begin a contextual review."
          to="/analysis"
          action="Explore analysis"
        />
      ) : (
        <div className="cases-layout">
          <section className="card case-list">
            <div className="section-heading">
              <h2>
                Cases <span className="count">{data.cases.length}</span>
              </h2>
            </div>
            {data.cases.map((c) => (
              <button
                className={"case-item " + (c.id === review.id ? "active" : "")}
                key={c.id}
                onClick={() => {
                  setSelected(c.id);
                  setError("");
                  setNote("");
                }}
              >
                <strong>{c.resultId.replace("~", " ? ")}</strong>
                <small>{c.id}</small>
                <Badge
                  tone={
                    c.status === "Closed" || c.status === "Resolved"
                      ? "teal"
                      : "amber"
                  }
                >
                  {c.status}
                </Badge>
              </button>
            ))}
          </section>
          <section className="card padded">
            <div className="section-heading">
              <div>
                <h2>{review.resultId.replace("~", " ? ")}</h2>
                <p>{review.id}</p>
              </div>
              <Link
                className="button small"
                to={"/evidence/" + encodeURIComponent(review.resultId)}
              >
                View evidence
                <ArrowUpRight size={15} />
              </Link>
            </div>
            <ol className="lifecycle">
              {statuses.map((s, i) => (
                <li key={s} className={i <= index ? "reached" : ""}>
                  <span>{i < index ? <Check size={13} /> : i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <h3>Local case history</h3>
            <div className="case-events">
              {review.events.map((e, i) => (
                <div className="case-event" key={i}>
                  <span className="event-dot" />
                  <div>
                    <small>
                      {new Date(e.at).toLocaleString()} · Demo {e.role}
                    </small>
                    <p>{e.text}</p>
                  </div>
                </div>
              ))}
            </div>
            {review.status !== "Closed" ? (
              <>
                <label>
                  {statuses[index + 1] === "Resolved"
                    ? "Resolution justification"
                    : "Reviewer note"}
                  <textarea
                    rows={4}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Describe the context, evidence, and reason for this action…"
                  />
                </label>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                <div className="button-row">
                  <button onClick={() => addEvent()}>Save note</button>
                  <button
                    className="primary"
                    onClick={() => addEvent(statuses[index + 1])}
                  >
                    Move to {statuses[index + 1]}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            ) : (
              <div className="notice">
                <CircleCheck size={18} />
                This local review is closed. Its evidence and notes remain
                available in reports.
              </div>
            )}
            <p className="muted">
              This browser history is not a server-enforced immutable audit
              trail. Resolving a case records a reviewer decision, not an
              automated misconduct finding.
            </p>
            <Link className="text-link" to="/reports">
              Create a report
              <ArrowRight size={15} />
            </Link>
          </section>
        </div>
      )}
    </>
  );
}
function Reports() {
  const { data, mode, setNotice } = useApp(),
    [selected, setSelected] = useState(""),
    [generating, setGenerating] = useState(false);
  const result =
    data.results.find((r) => r.id === selected) ?? rankResults(data.results)[0];
  const review = data.cases.find((c) => c.resultId === result?.id);
  return (
    <>
      <PageHeading
        eyebrow="A RECORD WITH CONTEXT"
        title="Evidence reports"
        description="Export the measurements, passages, exclusions, and reasoning behind a review."
      />
      {!result ? (
        <Empty
          title="No reports to generate yet"
          text="Run an analysis to create reports from actual document-pair results."
          to="/analysis"
          action="Open analysis"
        />
      ) : (
        <>
          <div className="card padded report-controls">
            <label>
              Document pair
              <select
                value={result.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {rankResults(data.results).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.a} ? {r.b} · {pct(r.score)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={generating || (mode === "supabase" && !review)}
              onClick={async () => {
                if (mode === "demo") {
                  downloadReport(reportHtml(data, result, review), result.id);
                  return;
                }
                if (!review) return;
                setGenerating(true);
                try {
                  const generated = await configuredSupabaseBackend().generateReport(review.id);
                  window.location.assign(generated.downloadUrl);
                  setNotice(`Hosted report generated. Its signed link expires in ${generated.expiresIn} seconds.`);
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Unable to generate the hosted report.");
                } finally {
                  setGenerating(false);
                }
              }}
            >
              <Download size={16} />
              {generating ? "Generating…" : mode === "demo" ? "Download HTML" : "Generate hosted report"}
            </button>
            <button onClick={() => window.print()}>
              <Printer size={16} />
              Print report
            </button>
          </div>
          <article className="card report-preview">
            <div className="report-brand">
              <Fingerprint size={26} />
              IntegrityLens <Badge>LOCAL DEMO REPORT</Badge>
            </div>
            <h1>Academic similarity review</h1>
            <p className="muted">
              Generated from analysis on{" "}
              {new Date(data.analyzedAt!).toLocaleString()} · Author metadata
              omitted
            </p>
            <h2>{data.documents.find((d) => d.id === result.a)?.title}</h2>
            <p>
              Compared with{" "}
              {data.documents.find((d) => d.id === result.b)?.title} ·{" "}
              {result.a} ? {result.b}
            </p>
            <div className="report-scores">
              <div>
                <strong>{pct(result.score)}</strong>
                <span>Similarity score / 100</span>
              </div>
              {Object.entries(result.components).map(([k, v]) => (
                <div key={k}>
                  <strong>{pct(v)}</strong>
                  <span>{k} coverage</span>
                </div>
              ))}
            </div>
            <ScoreFormula />
            <h2>Passage evidence</h2>
            {result.matches.length ? (
              result.matches.map((m, i) => (
                <div className="report-passage" key={m.id}>
                  <h3>
                    {i + 1}. {m.kind} match · {pct(m.similarity * 100)}%{" "}
                    {m.excluded && (
                      <Badge>EXCLUDED: {m.reasons.join(", ")}</Badge>
                    )}
                  </h3>
                  <small>
                    Characters {m.aStart}–{m.aEnd} ? {m.bStart}–{m.bEnd}
                  </small>
                  <blockquote>
                    {data.documents
                      .find((d) => d.id === result.a)!
                      .text.slice(m.aStart, m.aEnd)}
                  </blockquote>
                  <blockquote>
                    {data.documents
                      .find((d) => d.id === result.b)!
                      .text.slice(m.bStart, m.bEnd)}
                  </blockquote>
                </div>
              ))
            ) : (
              <p>No passages met the matching thresholds.</p>
            )}
            <h2>Detected exclusions</h2>
            {[
              ...result.exclusionsA.map((e) => ({ ...e, doc: result.a })),
              ...result.exclusionsB.map((e) => ({ ...e, doc: result.b })),
            ].map((e, i) => (
              <p key={i}>
                <b>
                  {e.doc} · {e.reason} · {e.start}–{e.end}
                </b>
                <br />
                {data.documents
                  .find((d) => d.id === e.doc)!
                  .text.slice(e.start, e.end)}
              </p>
            ))}
            <h2>Reviewer notes · {review?.status ?? "No case opened"}</h2>
            {review?.events.map((e, i) => (
              <p key={i}>
                <small>
                  {new Date(e.at).toLocaleString()} · {e.role}
                </small>
                <br />
                {e.text}
              </p>
            )) ?? <p>No reviewer notes recorded.</p>}
            <h2>Limitations</h2>
            <p>
              These are lexical similarity measurements, not probabilities of
              misconduct. Quote, reference, and template exclusions are
              heuristics, not citation verification. Local history is not an
              immutable audit trail. Demo roles are not security boundaries.
            </p>
            <p>
              {result.truncated
                ? "Evidence was truncated by analysis limits."
                : "No evidence limit was reached for this pair."}{" "}
              All documents are limited to 1,200 words; analysis examines at
              most 60 passages per document and 80 matches per pair. Fuzzy
              comparisons use passages of at most 128 tokens.
            </p>
            <LimitNote />
          </article>
        </>
      )}
    </>
  );
}
const labInfo: Record<
  string,
  { complexity: string; use: string; input: string; pattern: string }
> = {
  KMP: {
    complexity: "O(n + m) time · O(m) space",
    use: "Finds exact normalized passages in Evidence Explorer.",
    input: "ababcabcabababd",
    pattern: "ababd",
  },
  "Rabin–Karp": {
    complexity: "O(n + m) expected · O(nm) worst case",
    use: "Lab comparison of rolling hashes with character verification.",
    input: "a garden grows a garden",
    pattern: "garden",
  },
  "Z-algorithm": {
    complexity: "O(n) time · O(n) space",
    use: "Lab exploration of prefix matching.",
    input: "aabcaabxaaaz",
    pattern: "",
  },
  "Aho–Corasick": {
    complexity: "O(n + pattern lengths + matches), expected hash lookup",
    use: "Recognizes assignment-template passages for exclusion.",
    input: "ushers share her garden",
    pattern: "he,she,his,hers",
  },
  LCS: {
    complexity: "O(nm) time and space",
    use: "Fuzzy passage similarity and word-level evidence alignment.",
    input: "gardens build strong local relationships",
    pattern: "gardens support strong neighborhood relationships",
  },
  "Edit distance": {
    complexity: "O(nm) time · O(m) space",
    use: "Lab comparison of insertions, deletions, and substitutions.",
    input: "community gardens build connections",
    pattern: "shared gardens build lasting connections",
  },
  "AVL rotations": {
    complexity: "O(log n) per insert",
    use: "Lab balanced binary search tree; ranking uses stable insertion sort.",
    input: "30 20 10 25 28 40 50",
    pattern: "",
  },
  "B-tree splits": {
    complexity: "O(log n) per insert for fixed degree",
    use: "Lab multiway index with minimum degree 2.",
    input: "10 20 5 6 12 30 7 17",
    pattern: "",
  },
  "Union-find": {
    complexity: "O((V + E) a(V))",
    use: "Groups the similarity network into connected components.",
    input: "0 1 4 1 2 3 2 3 5 4 5 2",
    pattern: "",
  },
  Dijkstra: {
    complexity: "O((V + E) log E) with duplicate heap entries",
    use: "Finds shortest paths using 101 - similarity as distance.",
    input: "0 1 4 0 2 2 2 1 1 1 3 5 2 3 8",
    pattern: "",
  },
  "Max-flow": {
    complexity: "O(VE × V²) with matrix BFS; bounded lab",
    use: "Lab residual-network exploration; not used as an integrity score.",
    input: "0 1 8 0 2 5 1 2 3 1 3 5 2 3 8",
    pattern: "",
  },
};
function Lab() {
  const [algorithm, setAlgorithm] = useState("KMP"),
    [input, setInput] = useState(labInfo.KMP.input),
    [pattern, setPattern] = useState(labInfo.KMP.pattern),
    [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(700);
  const computed = useMemo(() => {
    try {
      return { ...runLab(algorithm, input, pattern), error: "" };
    } catch (e) {
      return { trace: [], output: "", error: (e as Error).message };
    }
  }, [algorithm, input, pattern]);
  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [computed]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setStep((s) => {
          if (s >= computed.trace.length - 1) {
            setPlaying(false);
            return s;
          }
          return s + 1;
        }),
      speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed, computed.trace.length]);
  const frame = computed.trace[Math.min(step, computed.trace.length - 1)],
    graph = ["Union-find", "Dijkstra", "Max-flow"].includes(algorithm),
    tree = ["AVL rotations", "B-tree splits"].includes(algorithm);
  return (
    <>
      <PageHeading
        eyebrow="OPEN THE BLACK BOX"
        title="Algorithm Lab"
        description="Follow real engine operations, one step at a time. Change the input and explore."
      />
      <div className="lab-layout">
        <aside className="card algorithm-list">
          <p className="nav-heading">CHOOSE AN ALGORITHM</p>
          {Object.keys(labInfo).map((a, i) => (
            <button
              className={a === algorithm ? "active" : ""}
              key={a}
              onClick={() => {
                setAlgorithm(a);
                setInput(labInfo[a].input);
                setPattern(labInfo[a].pattern);
              }}
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              {a}
              {a === algorithm && <ChevronRight size={15} />}
            </button>
          ))}
        </aside>
        <div>
          <section className="card padded">
            <div className="section-heading">
              <div>
                <h2>{algorithm}</h2>
                <p>{labInfo[algorithm].use}</p>
              </div>
              <Badge tone="teal">LIVE ENGINE TRACE</Badge>
            </div>
            <label>
              {graph
                ? "Directed edge triples for flow; undirected for paths: from to weight (nodes 0–7)"
                : tree
                  ? "Positive integer keys (space-separated)"
                  : "Input text (maximum 160 characters)"}
              <textarea
                aria-label="Lab input"
                maxLength={160}
                rows={2}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
            </label>
            {!graph && !tree && algorithm !== "Z-algorithm" && (
              <label>
                {algorithm === "Aho–Corasick"
                  ? "Patterns (comma-separated)"
                  : "Pattern / comparison text (maximum 80 characters)"}
                <input
                  aria-label="Lab pattern"
                  maxLength={80}
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                />
              </label>
            )}
            {computed.error ? (
              <p className="error" role="alert">
                {computed.error}
              </p>
            ) : (
              <>
                <div className="trace-stage">
                  <span className="eyebrow">
                    STEP {step + 1} OF {computed.trace.length}
                  </span>
                  <h3>{frame?.label}</h3>
                  <div className="trace-values">
                    {frame?.values.map((v, i) => (
                      <div
                        key={i}
                        className={frame.active.includes(i) ? "active" : ""}
                      >
                        <strong>{Number.isFinite(v) ? v : "8"}</strong>
                        <small>{i}</small>
                      </div>
                    ))}
                  </div>
                  <p>{frame?.detail}</p>
                </div>
                <div className="trace-controls">
                  <div className="button-row">
                    <button
                      aria-label="Reset trace"
                      onClick={() => {
                        setStep(0);
                        setPlaying(false);
                      }}
                    >
                      <RotateCcw size={17} />
                    </button>
                    <button
                      aria-label="Previous step"
                      disabled={!step}
                      onClick={() => {
                        setPlaying(false);
                        setStep(step - 1);
                      }}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <button
                      className="primary"
                      disabled={step >= computed.trace.length - 1 && !playing}
                      onClick={() => setPlaying(!playing)}
                    >
                      {playing ? <Pause size={17} /> : <Play size={17} />}{" "}
                      {playing ? "Pause" : "Play"}
                    </button>
                    <button
                      aria-label="Next step"
                      disabled={step >= computed.trace.length - 1}
                      onClick={() => {
                        setPlaying(false);
                        setStep(step + 1);
                      }}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                  <label className="speed">
                    Speed
                    <select
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      <option value={1400}>0.5×</option>
                      <option value={700}>1×</option>
                      <option value={350}>2×</option>
                    </select>
                  </label>
                </div>
                <input
                  aria-label="Trace step"
                  type="range"
                  min={0}
                  max={Math.max(0, computed.trace.length - 1)}
                  value={step}
                  onChange={(e) => {
                    setPlaying(false);
                    setStep(Number(e.target.value));
                  }}
                />
                <div className="lab-output">
                  <b>Result</b>
                  <code>{computed.output}</code>
                </div>
              </>
            )}
          </section>
          <div className="card padded">
            <h3>Complexity & bounds</h3>
            <p>{labInfo[algorithm].complexity}</p>
            <p className="muted">
              Traces come directly from the engine implementation. Playback
              changes only how quickly you inspect the recorded operations.
              Inputs are bounded; traces retain the first 500 events. Graph labs
              use eight nodes and source 0, target 3.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
function SettingsPage() {
  const { settings, setSettings, theme, setTheme, reset, run, progress, mode } =
      useApp(),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="MAKE THE REVIEW YOURS"
        title="Settings"
        description="Transparent scoring, contextual discounts, and local workspace preferences."
      />
      <div className="settings-grid">
        <section className="card padded">
          <h2>Similarity weights</h2>
          <p className="muted">
            Weights are normalized by their sum. Changing them requires a new
            analysis.
          </p>
          {(["exact", "shingle", "fuzzy"] as const).map((k) => (
            <label key={k} className="weight-label">
              <span>
                <span className={"legend-dot " + k} />
                {k}
                <b>{settings.weights[k].toFixed(1)}</b>
              </span>
              <input
                aria-label={k + " weight"}
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings.weights[k]}
                onChange={(e) => {
                  const next = {
                    ...settings.weights,
                    [k]: Number(e.target.value),
                  };
                  if (Object.values(next).some((v) => v > 0))
                    setSettings({ ...settings, weights: next });
                }}
              />
            </label>
          ))}
          <label>
            Dashboard review threshold
            <input
              type="number"
              min={0}
              max={100}
              value={settings.threshold}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  threshold: Math.min(100, Math.max(0, Number(e.target.value))),
                })
              }
            />
          </label>
          <button className="primary" disabled={!!progress} onClick={run}>
            <ScanLine size={17} />
            Recompute analysis
          </button>
        </section>
        <section className="card padded">
          <h2>Fairness & context</h2>
          <p className="muted">
            Every detected span remains visible in Evidence Explorer, including
            discounted matches.
          </p>
          {[
            {
              key: "discountQuotes",
              title: "Discount quoted passages",
              text: "Paired straight or curly double quotes enclosing at least 12 characters.",
            },
            {
              key: "discountReferences",
              title: "Discount reference sections",
              text: 'Everything after a standalone "References" or "Bibliography" heading.',
            },
            {
              key: "discountTemplates",
              title: "Discount instructor templates",
              text: "Aho–Corasick recognizes case-insensitive verbatim template sentences.",
            },
          ].map((o) => (
            <label className="setting-toggle" key={o.key}>
              <div>
                <strong>{o.title}</strong>
                <p>{o.text}</p>
              </div>
              <input
                type="checkbox"
                checked={settings[o.key as keyof Settings] as boolean}
                onChange={(e) =>
                  setSettings({ ...settings, [o.key]: e.target.checked })
                }
              />
            </label>
          ))}
          <p className="muted">
            These heuristics can miss formatting variants or discount unrelated
            content. They do not verify citations. Any overlap discounts the
            full matched passage.
          </p>
        </section>
        <section className="card padded">
          <h2>Appearance</h2>
          <p className="muted">Choose the environment that helps you focus.</p>
          <div className="theme-options">
            {[
              { id: "light", icon: Sun },
              { id: "dark", icon: Moon },
              { id: "system", icon: Monitor },
            ].map((t) => (
              <button
                key={t.id}
                className={theme === t.id ? "active" : ""}
                onClick={() => setTheme(t.id)}
                aria-pressed={theme === t.id}
              >
                <t.icon size={21} />
                {t.id}
              </button>
            ))}
          </div>
        </section>
        <section className="card padded">
          <h2>{mode === "demo" ? "Local data" : "Hosted data"}</h2>
          <p>
            {mode === "demo"
              ? "Documents, results, and cases are saved in IndexedDB in this browser. Small preferences use localStorage. Clearing site storage removes them."
              : "Documents, results, cases, and reports are protected by the configured Supabase project. Hosted data cannot be reset from this browser."}
          </p>
          {mode === "demo" && (
            <button className="danger" onClick={() => setConfirm(true)}>
              <RotateCcw size={16} />
              Reset demo workspace
            </button>
          )}
        </section>
      </div>
      {confirm && (
        <Modal title="Reset this local demo?" close={() => setConfirm(false)}>
          <p>
            This removes IntegrityLens documents, analysis results, review
            notes, and score preferences from this browser and restores the
            fictional corpus. Other apps and projects are unaffected.
          </p>
          {error && <p className="error">{error}</p>}
          <div className="button-row">
            <button onClick={() => setConfirm(false)}>Keep my workspace</button>
            <button
              className="danger"
              onClick={() => {
                void reset()
                  .then(() => setConfirm(false))
                  .catch((e) => setError(String(e)));
              }}
            >
              Reset IntegrityLens data
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function Help() {
  const { mode } = useApp();
  const location = useLocation(),
    [tour, setTour] = useState(location.search.includes("tour") ? 0 : -1);
  const steps = [
    {
      title: "Start with the documents",
      text: "The library includes fictional submissions, a reference source, and an instructor template. Add your own UTF-8 text.",
      to: "/documents",
    },
    {
      title: "Generate the evidence",
      text: "Run analysis to compare every eligible pair in a Web Worker. Results are computed, never prewritten.",
      to: "/analysis",
    },
    {
      title: "Review in context",
      text: "Inspect passages, check exclusions, then open a case. Add justification as the case moves through review.",
      to: "/cases",
    },
    {
      title: "Keep an explainable record",
      text: "Export an HTML report with evidence, reviewer notes, settings, and limitations.",
      to: "/reports",
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="A THOUGHTFUL APPROACH"
        title="Help & guidance"
        description="Understand what IntegrityLens can tell you, and what it cannot."
      >
        <button onClick={() => setTour(0)} className="primary">
          <Play size={16} />
          Start guided tour
        </button>
      </PageHeading>
      {tour >= 0 && (
        <section className="card padded tour">
          <Badge tone="teal">
            GUIDED TOUR · {tour + 1} OF {steps.length}
          </Badge>
          <h2>{steps[tour].title}</h2>
          <p>{steps[tour].text}</p>
          <div className="button-row">
            <Link className="button" to={steps[tour].to}>
              Open this page
              <ArrowUpRight size={15} />
            </Link>
            <button
              className="primary"
              onClick={() => setTour(tour === steps.length - 1 ? -1 : tour + 1)}
            >
              {tour === steps.length - 1 ? "Finish tour" : "Next step"}
              <ArrowRight size={15} />
            </button>
            <button onClick={() => setTour(-1)}>Close tour</button>
          </div>
        </section>
      )}
      <LimitNote />
      <div className="help-grid">
        <section className="card padded">
          <h2>Privacy & local storage</h2>
          <p>
            Demo mode makes no backend requests. Documents, cases, and results
            remain in this browser's IndexedDB. Theme, demo role, and scoring
            preferences are stored in localStorage.
          </p>
          <p>
            This browser data may be inspected or edited by anyone with access
            to the device. Clearing site storage removes it. Download reports
            before resetting if you need a record.
          </p>
          <p>
            All built-in people, institutions, documents, and publication
            references are fictional. Imported documents are provided by you.
          </p>
        </section>
        <section className="card padded">
          <h2>What the evidence means</h2>
          <p>
            <b>Exact:</b> KMP finds matching token sequences after ASCII case
            normalization and punctuation removal.
          </p>
          <p>
            <b>Shingle:</b> related passages share three-word sequences, with
            token LCS used to measure the match.
          </p>
          <p>
            <b>Fuzzy:</b> a common token subsequence indicates lexical overlap,
            not verified paraphrase or semantic equivalence.
          </p>
          <p>
            <b>Excluded:</b> a quotation, reference section, or template
            overlaps the match. A selected discount removes its score
            contribution.
          </p>
        </section>
        <section className="card padded">
          <h2>Keyboard & accessibility</h2>
          <p>
            <kbd>Tab</kbd> moves between controls. <kbd>Enter</kbd> activates
            them.
          </p>
          <p>
            <kbd>J</kbd> / <kbd>K</kbd> move to the next / previous passage in
            Evidence Explorer when not editing a field or focusing a button.
          </p>
          <p>
            <kbd>Esc</kbd> closes dialogs. Graph relationships are also
            available in a text list. Reduced-motion preferences are respected;
            lab playback starts only when you choose Play.
          </p>
        </section>
        <section className="card padded">
          <h2>Limits & future backend</h2>
          <p>
            Analysis is limited to 30 documents, each up to 20 KB and 1,200
            words. It processes 60 passages per document, 128 tokens per fuzzy
            passage, and 80 matches per pair. Non-ASCII text is not fully
            case-folded or linguistically segmented.
          </p>
          <p>
            No web search, authorship inference, AI-text detection, or citation
            verification is performed. A low score does not establish
            originality.
          </p>
          <p>{mode === "demo"
            ? "This local demo uses browser storage and demo roles. Authentication, server authorization, private Storage, and the hosted audit trail are inactive."
            : "This hosted workspace uses Supabase authentication, server authorization, private Storage, row-level security, and append-only case history. Complete the staging checklist before production use."}</p>
        </section>
      </div>
    </>
  );
}
function Root() {
  if (publicConfiguration.errors.length)
    return <ConfigurationError errors={publicConfiguration.errors} />;
  if (!supabaseMode) return <App />;
  return <HostedSession>{(profile, signOut) =>
    profile.role === "reviewer" || profile.role === "student"
      ? <HostedRoleWorkspace profile={profile} signOut={signOut} />
      : <App hostedProfile={profile} hostedSignOut={signOut} />
  }</HostedSession>;
}

createRoot(document.getElementById("root")!).render(<Root />);
