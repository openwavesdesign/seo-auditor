import { useState, useEffect } from "react";

// ── Minimal in-memory DB (persists via window global across re-renders) ──
if (!window.__SEO_DB) {
  window.__SEO_DB = { users: {}, sessions: {} };
}
const DB = window.__SEO_DB;

// ── Utility ──
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const fmt = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

// ── Auth helpers ──
function register(email, password) {
  if (DB.users[email]) return { error: "Account already exists." };
  const id = uid();
  DB.users[email] = { id, email, password, sites: [], audits: {} };
  return { ok: true };
}
function login(email, password) {
  const u = DB.users[email];
  if (!u || u.password !== password) return { error: "Invalid email or password." };
  const token = uid();
  DB.sessions[token] = email;
  return { token };
}
function getUser(token) {
  const email = DB.sessions[token];
  return email ? DB.users[email] : null;
}

// ── SEO Audit via Claude API ──
async function runAudit(url, apiKey) {
  const prompt = `You are an expert SEO auditor. Analyze the website at: ${url}

Perform a comprehensive SEO audit and return ONLY a JSON object (no markdown, no explanation) with this exact structure:

{
  "overallScore": <number 0-100>,
  "summary": "<2-3 sentence executive summary>",
  "categories": [
    {
      "name": "Technical SEO",
      "score": <0-100>,
      "icon": "⚙️",
      "issues": [
        {
          "title": "<issue title>",
          "description": "<what the problem is>",
          "fix": "<specific actionable fix>",
          "priority": "<Critical|High|Medium|Low>",
          "impact": "<SEO impact explanation>",
          "effort": "<Easy|Medium|Hard>"
        }
      ]
    },
    {
      "name": "On-Page SEO",
      "score": <0-100>,
      "icon": "📄",
      "issues": [...]
    },
    {
      "name": "Content Quality",
      "score": <0-100>,
      "icon": "✍️",
      "issues": [...]
    },
    {
      "name": "Performance",
      "score": <0-100>,
      "icon": "⚡",
      "issues": [...]
    },
    {
      "name": "Backlinks & Authority",
      "score": <0-100>,
      "icon": "🔗",
      "issues": [...]
    },
    {
      "name": "Mobile & UX",
      "score": <0-100>,
      "icon": "📱",
      "issues": [...]
    }
  ],
  "quickWins": ["<actionable quick win 1>", "<actionable quick win 2>", "<actionable quick win 3>"]
}

Base the audit on what you know about the domain, common SEO patterns, and what can be inferred from the URL itself. Give realistic scores and specific, actionable advice. Include 2-5 issues per category. Prioritize the most impactful issues.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    let errMsg = `API error ${res.status}`;
    try { const e = await res.json(); if (e.error?.message) errMsg = e.error.message; } catch (_) {}
    throw new Error(errMsg);
  }
  const data = await res.json();
  const text = data.content?.map((b) => b.text || "").join("") || "";
  if (!text) throw new Error("Empty response from API. The model may have stopped early.");
  const clean = text.replace(/```json[\s\S]*?```|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (_) {
    throw new Error("Could not parse audit response as JSON. Try running the audit again.");
  }
}

// ── Color helpers ──
function scoreColor(s) {
  if (s >= 80) return "#22c55e";
  if (s >= 60) return "#f59e0b";
  if (s >= 40) return "#f97316";
  return "#ef4444";
}
function scoreLabel(s) {
  if (s >= 80) return "Good";
  if (s >= 60) return "Needs Work";
  if (s >= 40) return "Poor";
  return "Critical";
}
function priorityColor(p) {
  return { Critical: "#ef4444", High: "#f97316", Medium: "#f59e0b", Low: "#6b7280" }[p] || "#6b7280";
}
function effortBadge(e) {
  return { Easy: "#22c55e", Medium: "#f59e0b", Hard: "#ef4444" }[e] || "#6b7280";
}

// ── Score Ring ──
function ScoreRing({ score, size = 120, stroke = 10 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1s ease" }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ transform: "rotate(90deg)", transformOrigin: "50% 50%", fill: color, fontSize: size * 0.22, fontWeight: 800, fontFamily: "'DM Mono', monospace" }}>
        {score}
      </text>
    </svg>
  );
}

// ── Mini score bar ──
function ScoreBar({ score }) {
  const color = scoreColor(score);
  return (
    <div style={{ width: "100%", height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.8s ease" }} />
    </div>
  );
}

// ── SCREENS ──

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    setErr("");
    if (!email || !pass) return setErr("Please fill in all fields.");
    if (mode === "register") {
      const r = register(email, pass);
      if (r.error) return setErr(r.error);
      const { token } = login(email, pass);
      onAuth(token);
    } else {
      const r = login(email, pass);
      if (r.error) return setErr(r.error);
      onAuth(r.token);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#020817", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: 20 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 36, height: 36, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📊</div>
            <span style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", fontFamily: "'DM Mono', monospace", letterSpacing: -1 }}>SiteScore</span>
          </div>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>SEO audits that tell you what to fix, not just what's broken.</p>
        </div>

        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: 32 }}>
          <div style={{ display: "flex", background: "#020817", borderRadius: 10, padding: 4, marginBottom: 28, gap: 4 }}>
            {["login", "register"].map((m) => (
              <button key={m} onClick={() => { setMode(m); setErr(""); }}
                style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s",
                  background: mode === m ? "#6366f1" : "transparent", color: mode === m ? "white" : "#64748b" }}>
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          {["Email", "Password"].map((label, i) => (
            <div key={label} style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</label>
              <input type={i === 1 ? "password" : "email"} value={i === 0 ? email : pass}
                onChange={(e) => i === 0 ? setEmail(e.target.value) : setPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={i === 0 ? "you@example.com" : "••••••••"}
                style={{ width: "100%", padding: "12px 14px", background: "#020817", border: "1px solid #1e293b", borderRadius: 10, color: "#f1f5f9", fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box" }} />
            </div>
          ))}

          {err && <div style={{ background: "#1e0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 16 }}>{err}</div>}

          <button onClick={submit}
            style={{ width: "100%", padding: "13px 0", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", borderRadius: 10, color: "white", fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", cursor: "pointer", marginTop: 4 }}>
            {mode === "login" ? "Sign In →" : "Create Account →"}
          </button>
        </div>

        <p style={{ textAlign: "center", color: "#1e293b", fontSize: 12, marginTop: 24 }}>
          Demo: use any email + password to register, then sign in.
        </p>
      </div>
    </div>
  );
}

function ApiKeyScreen({ onKey }) {
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    const trimmed = key.trim();
    if (!trimmed) return setErr("Please enter your Anthropic API key.");
    if (!trimmed.startsWith("sk-ant-")) return setErr("That doesn't look like a valid Anthropic API key (should start with sk-ant-).");
    sessionStorage.setItem("seo_api_key", trimmed);
    onKey(trimmed);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#020817", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: 20 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 36, height: 36, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🔑</div>
            <span style={{ fontSize: 24, fontWeight: 700, color: "#f1f5f9", fontFamily: "'DM Mono', monospace", letterSpacing: -1 }}>SiteScore</span>
          </div>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>Enter your Anthropic API key to run audits.</p>
        </div>
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: 32 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Anthropic API Key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="sk-ant-..."
            style={{ width: "100%", padding: "12px 14px", background: "#020817", border: "1px solid #1e293b", borderRadius: 10, color: "#f1f5f9", fontSize: 14, fontFamily: "'DM Mono', monospace", outline: "none", boxSizing: "border-box", marginBottom: 16 }}
          />
          {err && <div style={{ background: "#1e0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 16 }}>{err}</div>}
          <button onClick={submit}
            style={{ width: "100%", padding: "13px 0", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", borderRadius: 10, color: "white", fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>
            Save Key →
          </button>
        </div>
        <p style={{ textAlign: "center", color: "#1e293b", fontSize: 12, marginTop: 24 }}>
          Your key is stored in sessionStorage only — never sent anywhere except Anthropic's API.
        </p>
      </div>
    </div>
  );
}

function Dashboard({ token, onLogout, apiKey, onClearKey }) {
  const [user, setUser] = useState(() => getUser(token));
  const [url, setUrl] = useState(user?.sites?.[0] || "");
  const [editingUrl, setEditingUrl] = useState(!user?.sites?.[0]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [view, setView] = useState("dashboard"); // dashboard | report

  const refreshUser = () => setUser({ ...DB.users[DB.sessions[token]] });

  const saveUrl = () => {
    let u = url.trim();
    if (!u) return;
    if (!u.startsWith("http")) u = "https://" + u;
    DB.users[DB.sessions[token]].sites = [u];
    setUrl(u);
    setEditingUrl(false);
    refreshUser();
  };

  const doAudit = async () => {
    if (!url) return;
    setRunning(true);
    setProgress("Fetching site structure...");
    const steps = ["Analyzing meta tags...", "Checking content quality...", "Evaluating backlink profile...", "Assessing mobile experience...", "Computing final scores..."];
    let si = 0;
    const ticker = setInterval(() => { if (si < steps.length) setProgress(steps[si++]); }, 1200);
    try {
      const result = await runAudit(url, apiKey);
      clearInterval(ticker);
      const auditId = uid();
      const audit = { id: auditId, url, createdAt: now(), ...result };
      const email = DB.sessions[token];
      if (!DB.users[email].audits[url]) DB.users[email].audits[url] = [];
      DB.users[email].audits[url].unshift(audit);
      refreshUser();
      setSelectedAudit(audit);
      setActiveCategory(audit.categories?.[0]?.name || null);
      setView("report");
    } catch (e) {
      clearInterval(ticker);
      alert("Audit failed: " + e.message);
    }
    setRunning(false);
    setProgress("");
  };

  const audits = url && user?.audits?.[url] ? user.audits[url] : [];

  if (view === "report" && selectedAudit) {
    return <ReportView audit={selectedAudit} activeCategory={activeCategory} setActiveCategory={setActiveCategory} onBack={() => setView("dashboard")} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#020817", fontFamily: "'DM Sans', sans-serif", color: "#f1f5f9" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* Nav */}
      <nav style={{ borderBottom: "1px solid #0f172a", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📊</div>
          <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 18, letterSpacing: -0.5 }}>SiteScore</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, color: "#64748b" }}>{user?.email}</span>
          <button onClick={onClearKey} style={{ fontSize: 13, color: "#64748b", background: "none", border: "1px solid #1e293b", padding: "6px 14px", borderRadius: 8, cursor: "pointer" }}>API Key</button>
          <button onClick={onLogout} style={{ fontSize: 13, color: "#64748b", background: "none", border: "1px solid #1e293b", padding: "6px 14px", borderRadius: 8, cursor: "pointer" }}>Sign out</button>
        </div>
      </nav>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
        {/* Site Setup */}
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: 28, marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Your Website</h2>
              <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 14 }}>Add the URL you want to audit</p>
            </div>
            {!editingUrl && url && (
              <button onClick={() => setEditingUrl(true)} style={{ fontSize: 12, color: "#6366f1", background: "none", border: "1px solid #312e81", padding: "6px 12px", borderRadius: 8, cursor: "pointer" }}>Edit URL</button>
            )}
          </div>

          {editingUrl ? (
            <div style={{ display: "flex", gap: 10 }}>
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveUrl()}
                placeholder="https://yourwebsite.com"
                style={{ flex: 1, padding: "12px 16px", background: "#020817", border: "1px solid #1e293b", borderRadius: 10, color: "#f1f5f9", fontSize: 14, fontFamily: "'DM Sans', sans-serif", outline: "none" }} />
              <button onClick={saveUrl} style={{ padding: "12px 20px", background: "#6366f1", border: "none", borderRadius: 10, color: "white", fontWeight: 600, fontSize: 14, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>Save</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, background: "#020817", borderRadius: 10, border: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🌐</div>
                <div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: "#a5b4fc" }}>{url}</div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
                    {audits.length > 0 ? `${audits.length} audit${audits.length > 1 ? "s" : ""} run` : "No audits yet"}
                  </div>
                </div>
              </div>
              <button onClick={doAudit} disabled={running}
                style={{ padding: "12px 28px", background: running ? "#1e293b" : "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", borderRadius: 10, color: running ? "#64748b" : "white", fontWeight: 700, fontSize: 14, fontFamily: "'DM Sans', sans-serif", cursor: running ? "not-allowed" : "pointer", minWidth: 160, transition: "all 0.2s" }}>
                {running ? "⏳ Auditing..." : "▶ Run Audit"}
              </button>
            </div>
          )}

          {running && (
            <div style={{ marginTop: 20, background: "#020817", borderRadius: 10, padding: 16, border: "1px solid #1e293b" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1", animation: "pulse 1s infinite" }} />
                <span style={{ fontSize: 13, color: "#a5b4fc" }}>{progress}</span>
              </div>
              <div style={{ height: 3, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "linear-gradient(90deg, #6366f1, #8b5cf6)", borderRadius: 2, animation: "loading 1.5s ease infinite", width: "60%" }} />
              </div>
            </div>
          )}
        </div>

        {/* Audit History */}
        {audits.length > 0 && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>Audit History</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {audits.map((a, i) => (
                <div key={a.id} onClick={() => { setSelectedAudit(a); setActiveCategory(a.categories?.[0]?.name); setView("report"); }}
                  style={{ background: "#0f172a", border: `1px solid ${i === 0 ? "#312e81" : "#1e293b"}`, borderRadius: 14, padding: 20, cursor: "pointer", display: "flex", alignItems: "center", gap: 20, transition: "border-color 0.2s" }}>
                  <ScoreRing score={a.overallScore} size={72} stroke={7} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{scoreLabel(a.overallScore)}</span>
                      {i === 0 && <span style={{ fontSize: 11, background: "#1e1b4b", color: "#a5b4fc", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>Latest</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#475569", marginBottom: 10 }}>{fmt(a.createdAt)}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {a.categories?.map((c) => (
                        <div key={c.name} style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
                          <span>{c.icon}</span>
                          <span style={{ color: scoreColor(c.score), fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>{c.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ color: "#334155", fontSize: 20 }}>→</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {audits.length === 0 && !running && url && !editingUrl && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#334155" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#475569", marginBottom: 8 }}>Ready to audit</div>
            <div style={{ fontSize: 14 }}>Press "Run Audit" to analyze your website's SEO</div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes loading { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
      `}</style>
    </div>
  );
}

function ReportView({ audit, activeCategory, setActiveCategory, onBack }) {
  const cat = audit.categories?.find((c) => c.name === activeCategory) || audit.categories?.[0];
  const criticalCount = audit.categories?.flatMap((c) => c.issues).filter((i) => i.priority === "Critical").length || 0;
  const highCount = audit.categories?.flatMap((c) => c.issues).filter((i) => i.priority === "High").length || 0;

  return (
    <div style={{ minHeight: "100vh", background: "#020817", fontFamily: "'DM Sans', sans-serif", color: "#f1f5f9" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* Nav */}
      <nav style={{ borderBottom: "1px solid #0f172a", padding: "0 32px", display: "flex", alignItems: "center", gap: 16, height: 60 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>←</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📊</div>
          <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 18, letterSpacing: -0.5 }}>SiteScore</span>
        </div>
        <span style={{ color: "#334155", fontSize: 18 }}>/</span>
        <span style={{ fontSize: 14, color: "#64748b", fontFamily: "'DM Mono', monospace" }}>{audit.url}</span>
        <span style={{ fontSize: 12, color: "#475569", marginLeft: "auto" }}>{fmt(audit.createdAt)}</span>
      </nav>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        {/* Score Hero */}
        <div style={{ background: "linear-gradient(135deg, #0f172a, #0d0f1e)", border: "1px solid #1e293b", borderRadius: 20, padding: 32, marginBottom: 28, display: "flex", gap: 40, alignItems: "center", flexWrap: "wrap" }}>
          <ScoreRing score={audit.overallScore} size={140} stroke={12} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 4 }}>
              {scoreLabel(audit.overallScore)} — <span style={{ color: scoreColor(audit.overallScore) }}>{audit.overallScore}/100</span>
            </div>
            <p style={{ color: "#94a3b8", margin: "0 0 20px", lineHeight: 1.6, fontSize: 14 }}>{audit.summary}</p>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {criticalCount > 0 && <div style={{ background: "#1e0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "6px 14px", fontSize: 13, color: "#fca5a5" }}>🔴 {criticalCount} Critical</div>}
              {highCount > 0 && <div style={{ background: "#1a1000", border: "1px solid #7c2d12", borderRadius: 8, padding: "6px 14px", fontSize: 13, color: "#fed7aa" }}>🟠 {highCount} High priority</div>}
            </div>
          </div>
          {/* Category scores summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", minWidth: 260 }}>
            {audit.categories?.map((c) => (
              <div key={c.name} onClick={() => setActiveCategory(c.name)} style={{ cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{c.icon} {c.name.replace(" SEO", "")}</span>
                  <span style={{ fontSize: 12, fontFamily: "'DM Mono', monospace", color: scoreColor(c.score), fontWeight: 700 }}>{c.score}</span>
                </div>
                <ScoreBar score={c.score} />
              </div>
            ))}
          </div>
        </div>

        {/* Quick Wins */}
        {audit.quickWins?.length > 0 && (
          <div style={{ background: "#0a1628", border: "1px solid #1e3a5f", borderRadius: 14, padding: 22, marginBottom: 28 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "#7dd3fc" }}>⚡ Quick Wins</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {audit.quickWins.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: "#0ea5e9", fontWeight: 700, fontSize: 14, marginTop: 1 }}>{i + 1}.</span>
                  <span style={{ fontSize: 14, color: "#cbd5e1", lineHeight: 1.5 }}>{w}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Category Tabs + Issues */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {audit.categories?.map((c) => (
            <button key={c.name} onClick={() => setActiveCategory(c.name)}
              style={{ padding: "8px 16px", borderRadius: 10, border: `1px solid ${activeCategory === c.name ? "#4f46e5" : "#1e293b"}`, background: activeCategory === c.name ? "#1e1b4b" : "#0f172a", color: activeCategory === c.name ? "#a5b4fc" : "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
              {c.icon} {c.name} <span style={{ fontFamily: "'DM Mono', monospace", color: scoreColor(c.score) }}>{c.score}</span>
            </button>
          ))}
        </div>

        {cat && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
              <span style={{ fontSize: 24 }}>{cat.icon}</span>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{cat.name}</h2>
                <span style={{ fontSize: 13, color: scoreColor(cat.score), fontWeight: 700 }}>{cat.score}/100 — {scoreLabel(cat.score)}</span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {cat.issues?.sort((a, b) => ["Critical", "High", "Medium", "Low"].indexOf(a.priority) - ["Critical", "High", "Medium", "Low"].indexOf(b.priority)).map((issue, i) => (
                <IssueCard key={i} issue={issue} />
              ))}
              {!cat.issues?.length && (
                <div style={{ textAlign: "center", padding: 40, color: "#22c55e", fontSize: 16 }}>✅ No major issues found in this category!</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IssueCard({ issue }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "#0f172a", border: `1px solid ${open ? "#1e293b" : "#0f172a"}`, borderLeft: `3px solid ${priorityColor(issue.priority)}`, borderRadius: 12, overflow: "hidden", transition: "border-color 0.2s" }}>
      <div onClick={() => setOpen(!open)} style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{issue.title}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, background: `${priorityColor(issue.priority)}20`, color: priorityColor(issue.priority), padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>{issue.priority}</span>
            <span style={{ fontSize: 11, background: `${effortBadge(issue.effort)}20`, color: effortBadge(issue.effort), padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>Effort: {issue.effort}</span>
          </div>
        </div>
        <span style={{ color: "#334155", transition: "transform 0.2s", transform: open ? "rotate(90deg)" : "none" }}>›</span>
      </div>
      {open && (
        <div style={{ padding: "0 20px 20px", borderTop: "1px solid #1e293b" }}>
          <div style={{ paddingTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#475569", fontWeight: 700, marginBottom: 6 }}>Issue</div>
              <p style={{ margin: 0, fontSize: 14, color: "#94a3b8", lineHeight: 1.6 }}>{issue.description}</p>
            </div>
            <div style={{ background: "#071828", border: "1px solid #0c2b45", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#0ea5e9", fontWeight: 700, marginBottom: 6 }}>🔧 How to Fix</div>
              <p style={{ margin: 0, fontSize: 14, color: "#7dd3fc", lineHeight: 1.6 }}>{issue.fix}</p>
            </div>
            <div style={{ background: "#071a0f", border: "1px solid #0f3320", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#4ade80", fontWeight: 700, marginBottom: 6 }}>📈 SEO Impact</div>
              <p style={{ margin: 0, fontSize: 14, color: "#86efac", lineHeight: 1.6 }}>{issue.impact}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── App Root ──
export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("seo_token") || null);
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem("seo_api_key") || null);

  const handleAuth = (t) => {
    sessionStorage.setItem("seo_token", t);
    setToken(t);
  };
  const handleLogout = () => {
    sessionStorage.removeItem("seo_token");
    setToken(null);
  };
  const handleClearKey = () => {
    sessionStorage.removeItem("seo_api_key");
    setApiKey(null);
  };

  if (!token || !getUser(token)) return <AuthScreen onAuth={handleAuth} />;
  if (!apiKey) return <ApiKeyScreen onKey={(k) => setApiKey(k)} />;
  return <Dashboard token={token} onLogout={handleLogout} apiKey={apiKey} onClearKey={handleClearKey} />;
}
