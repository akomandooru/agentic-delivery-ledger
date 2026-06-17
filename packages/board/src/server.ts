import { createServer } from "node:http";
import { RecordStore, project, computeRetro, formatDuration } from "@adl/core";
import type { WorkItem, RecordEvent } from "@adl/protocol";

/**
 * Thin read-only board. A zero-build Node HTTP server that renders the record as columns and
 * auto-refreshes. Deliberately not a product UI and not a React/Vite app: it is the minimal
 * live view over the record (the record is the source of truth; this only reads it).
 */
const DB = process.env.ADL_DB ?? "./out/demo.jsonl";
const PORT = Number(process.env.PORT ?? 4000);

const COLUMNS: { state: string; label: string }[] = [
  { state: "candidate", label: "Candidate" },
  { state: "declared", label: "Declared" },
  { state: "in_progress", label: "In progress" },
  { state: "awaiting_validation", label: "Awaiting validation" },
  { state: "validated", label: "Validated" },
  { state: "in_production", label: "In production" },
  { state: "stabilized", label: "Stabilized" },
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** Classify an event as an agent claim, verified ground truth, or a neutral structural event. */
function trustClass(e: RecordEvent): "claim" | "verified" | "neutral" {
  if (e.kind === "ClaimPosted") return "claim";
  if (e.kind === "GroundTruthObserved" || e.kind === "GateSatisfied") return "verified";
  return "neutral";
}

/** Human-readable description of what an event did. */
function eventLabel(e: RecordEvent): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case "ItemDeclared":
      return `declared as ${esc(String(d.type ?? "item"))}`;
    case "ClaimPosted":
      return `claimed ${esc(String(d.claimedState ?? "?"))}`;
    case "GroundTruthObserved":
      return `verified ${esc(String(d.signal ?? "?"))}`;
    case "GateSatisfied":
      return `gate "${esc(String(d.gate ?? "?"))}" satisfied`;
    case "StateChanged":
      return `state -> ${esc(String(d.state ?? d.to ?? "?"))}`;
    default:
      return esc(String(e.kind));
  }
}

/** HH:MM:SS from an ISO timestamp. */
function shortTime(at: string): string {
  const d = new Date(at);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 19);
}

/** Collapsible per-item activity trail: every actor and transition, in order. */
function trail(events: readonly RecordEvent[], id: string): string {
  if (!events.length) return "";
  const rows = events
    .map((e) => {
      const cls = trustClass(e);
      const tag = cls === "claim" ? "claim" : cls === "verified" ? "verified" : "";
      return `<div class="trow ${cls}">
        <span class="ttime">${esc(shortTime(e.at))}</span>
        <span class="tactor">${esc(e.actor)}</span>
        <span class="twhat">${eventLabel(e)}</span>
        ${tag ? `<span class="ttag ${cls}">${tag}</span>` : ""}
      </div>`;
    })
    .join("");
  return `<details class="trail" data-trail="${esc(id)}"><summary>history (${events.length})</summary>${rows}</details>`;
}

function card(i: WorkItem, events: readonly RecordEvent[], childCount: number): string {
  const claimed =
    i.claimedState && i.claimedState !== i.verifiedState
      ? `<div class="claimed">claimed: ${esc(i.claimedState)} · superseded by verified: ${esc(i.verifiedState)}</div>`
      : "";
  const flags = i.flags
    .map((f) => `<span class="flag ${f}">${esc(f)}</span>`)
    .join(" ");
  const rolled = childCount > 0
    ? `<div class="rolled">rolled up from ${childCount} child item${childCount === 1 ? "" : "s"} (least-advanced)</div>`
    : "";
  const audit = i.type === "intent"
    ? `<div class="audit"><a href="/retro?intent=${encodeURIComponent(i.id)}">audit this delivery →</a></div>`
    : "";
  return `<div class="card ${i.type}">
    <div class="title">${esc(i.title)}</div>
    <div class="meta">${esc(i.type)} · ${esc(i.id)}</div>
    ${rolled}${claimed}${flags}${audit}
    ${trail(events, i.id)}
  </div>`;
}

function render(items: WorkItem[], eventsByItem: Map<string, RecordEvent[]>, autoRefresh: boolean): string {
  const childCount = new Map<string, number>();
  for (const i of items) {
    if (i.parentId) childCount.set(i.parentId, (childCount.get(i.parentId) ?? 0) + 1);
  }
  const byState = new Map<string, WorkItem[]>();
  for (const c of COLUMNS) byState.set(c.state, []);
  for (const i of items) {
    // map non-column states into the nearest column bucket
    const col = COLUMNS.find((c) => c.state === i.verifiedState)?.state
      ?? (i.verifiedState === "clarifying" ? "candidate" : i.verifiedState === "proposed" ? "declared" : "declared");
    byState.get(col)!.push(i);
  }
  const cols = COLUMNS.map(
    (c) => `<div class="col"><h2>${c.label} <span>${byState.get(c.state)!.length}</span></h2>
      ${byState.get(c.state)!.map((it) => card(it, eventsByItem.get(it.id) ?? [], childCount.get(it.id) ?? 0)).join("")}</div>`,
  ).join("");

  const awaiting = items.filter((i) => i.verifiedState === "awaiting_validation").length;
  const cnv = items.filter((i) => i.flags.includes("claimed-not-verified")).length;
  const oob = items.filter((i) => i.flags.includes("out-of-bounds")).length;

  return `<!doctype html><html><head><meta charset="utf-8">
  ${autoRefresh ? '<meta http-equiv="refresh" content="3">' : ""}
  <title>Agentic Delivery Ledger — board</title>
  <style>
    body { font: 14px system-ui, sans-serif; margin: 0; background: #0f1117; color: #e6e6e6; }
    header { padding: 12px 20px; background: #161a23; border-bottom: 1px solid #262b36; }
    header b { color: #fff; }
    .alerts { padding: 8px 20px; background: #161a23; color: #cbd2dd; }
    .alerts .num { color: #ffd479; font-weight: 600; }
    .board { display: flex; gap: 12px; padding: 16px; }
    .col { flex: 1 1 0; min-width: 120px; background: #161a23; border: 1px solid #262b36; border-radius: 8px; padding: 8px; }
    .col h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #8b94a3; margin: 4px 4px 10px; }
    .col h2 span { color: #fff; }
    .card { background: #1d2230; border: 1px solid #2c3343; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
    .card.intent { border-left: 3px solid #7c5cff; }
    .card.epic { border-left: 3px solid #2f9e7f; }
    .title { font-weight: 600; color: #fff; }
    .meta { color: #8b94a3; font-size: 12px; margin-top: 2px; }
    .claimed { margin-top: 6px; font-size: 12px; color: #ffd479; }
    .rolled { margin-top: 6px; font-size: 11px; color: #7c9cff; }
    .audit { margin-top: 6px; font-size: 11px; }
    .audit a { color: #7c9cff; text-decoration: none; }
    .audit a:hover { text-decoration: underline; }
    .flag { display: inline-block; margin-top: 6px; font-size: 11px; padding: 1px 6px; border-radius: 10px; }
    .flag.claimed-not-verified { background: #4a3a00; color: #ffd479; }
    .flag.out-of-bounds { background: #4a1f1f; color: #ff8a8a; }
    .nav { float: right; color: #6b7280; }
    .nav a { color: #7c9cff; text-decoration: none; }
    .nav a:hover { text-decoration: underline; }
    .nav .paused { color: #ffd479; }
    .trail { margin-top: 8px; border-top: 1px solid #2c3343; padding-top: 6px; }
    .trail summary { cursor: pointer; color: #b9c2cf; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; list-style: none; }
    .trail summary::-webkit-details-marker { display: none; }
    .trail summary:before { content: "▸ "; color: #8b94a3; }
    .trail[open] summary:before { content: "▾ "; }
    .trow { display: flex; align-items: baseline; gap: 8px; font-size: 13px; line-height: 1.4; padding: 5px 0; border-left: 3px solid #3a4252; padding-left: 10px; margin-top: 5px; }
    .trow.claim { border-left-color: #ffd479; }
    .trow.verified { border-left-color: #36c08f; }
    .ttime { color: #9aa4b2; font-variant-numeric: tabular-nums; }
    .tactor { color: #ffffff; font-weight: 600; }
    .twhat { color: #d4dbe6; }
    .ttag { margin-left: auto; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 8px; }
    .ttag.claim { background: #5a4600; color: #ffd479; }
    .ttag.verified { background: #15493a; color: #8df0cd; }
  </style></head>
  <body>
    <header><b>Agentic Delivery Ledger</b> — verified system of record (read-only${autoRefresh ? ", auto-refresh" : ", <span class='paused'>refresh paused</span>"})
      <span class="nav"><a href="/">board</a> · <a href="/retro">retro</a> · ${autoRefresh ? `<a href="/?refresh=off">pause</a>` : `<a class="paused" href="/">resume</a>`}</span></header>
    <div class="alerts">Awaiting validation: <span class="num">${awaiting}</span> &nbsp;·&nbsp;
      Claimed-not-verified: <span class="num">${cnv}</span> &nbsp;·&nbsp;
      Out of bounds: <span class="num">${oob}</span></div>
    <div class="board">${cols}</div>
    <script>
      // Keep expanded history panels open across the 3s auto-refresh (and on manual reload),
      // so they don't collapse mid-recording. State is per-item in localStorage.
      (function () {
        var KEY = "adl-open-trails";
        var open = new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
        document.querySelectorAll("details[data-trail]").forEach(function (d) {
          var id = d.getAttribute("data-trail");
          if (open.has(id)) d.open = true;
          d.addEventListener("toggle", function () {
            if (d.open) open.add(id); else open.delete(id);
            localStorage.setItem(KEY, JSON.stringify(Array.from(open)));
          });
        });
      })();
    </script>
  </body></html>`;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function barRow(label: string, sub: string, rate: number, value: string): string {
  return `<div class="mrow">
    <span class="mlabel">${esc(label)}</span>
    <span class="msub">${esc(sub)}</span>
    <span class="mbar"><span class="mfill" style="width:${Math.round(rate * 100)}%"></span></span>
    <span class="mval">${esc(value)}</span>
  </div>`;
}

function renderRetro(store: RecordStore, intentId?: string): string {
  let r;
  try {
    r = computeRetro(store, { intentId });
  } catch (e) {
    return `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;background:#0f1117;color:#e6e6e6;padding:20px">
      <p>${esc(String((e as Error).message))}</p><p><a style="color:#7c9cff" href="/retro">back to whole-ledger retro</a></p></body>`;
  }
  const c = r.claims;
  const scopeLine = r.scopeIntentId
    ? `scoped to intent <b style="color:#fff">${esc(r.scopeIntentId)}</b> — ${esc(r.scopeIntentTitle ?? "")} · <a class="navlink" href="/retro">view whole ledger</a>`
    : `whole ledger`;

  const funnel = r.funnel.length
    ? r.funnel.map((f) => `<div class="mrow"><span class="mlabel">${esc(f.state)}</span><span class="mval">${f.count}</span></div>`).join("")
    : `<div class="muted">no items</div>`;

  const timings = r.stageTimings.length
    ? r.stageTimings.map((s) => {
        const slow = r.bottleneck && s.state === r.bottleneck.state ? ` <span class="slow">slowest</span>` : "";
        return `<div class="mrow"><span class="mlabel">${esc(s.state)}${slow}</span>
          <span class="msub">n=${s.samples}</span>
          <span class="mval">mean ${esc(formatDuration(s.meanMs))} · max ${esc(formatDuration(s.maxMs))}</span></div>`;
      }).join("")
    : `<div class="muted">not enough transitions yet</div>`;

  const gates = r.gates.length
    ? r.gates.map((g) => barRow(g.name, g.satisfiedBy, g.satisfactionRate, `${g.satisfiedOn}/${g.declaredOn}`)).join("")
    : `<div class="muted">no gates declared</div>`;

  return `<!doctype html><html><head><meta charset="utf-8">
  <meta http-equiv="refresh" content="5">
  <title>Agentic Delivery Ledger — retro</title>
  <style>
    body { font: 14px system-ui, sans-serif; margin: 0; background: #0f1117; color: #e6e6e6; }
    header { padding: 12px 20px; background: #161a23; border-bottom: 1px solid #262b36; }
    header b { color: #fff; }
    .nav { float: right; color: #6b7280; }
    .nav a { color: #7c9cff; text-decoration: none; }
    .nav a:hover { text-decoration: underline; }
    .sub { padding: 8px 20px; color: #8b94a3; background: #161a23; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; padding: 16px; }
    .panel { background: #161a23; border: 1px solid #262b36; border-radius: 8px; padding: 14px 16px; }
    .panel h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #8b94a3; margin: 0 0 12px; }
    .big { font-size: 30px; font-weight: 700; color: #fff; }
    .big.good { color: #7fe0bd; } .big.warn { color: #ffd479; }
    .mrow { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 13px; }
    .mlabel { color: #e6e6e6; min-width: 130px; }
    .msub { color: #8b94a3; font-size: 12px; min-width: 60px; }
    .mval { color: #fff; margin-left: auto; font-variant-numeric: tabular-nums; }
    .mbar { flex: 1; height: 8px; background: #2c3343; border-radius: 4px; overflow: hidden; min-width: 60px; }
    .mfill { display: block; height: 100%; background: #2f9e7f; }
    .muted { color: #6b7280; font-size: 13px; }
    .slow { color: #ff8a8a; font-size: 11px; }
    .kv { color: #8b94a3; } .kv b { color: #fff; }
    .navlink { color: #7c9cff; text-decoration: none; }
    .navlink:hover { text-decoration: underline; }
  </style></head>
  <body>
    <header><b>Agentic Delivery Ledger</b> — retro / metrics (replayed from the ledger)
      <span class="nav"><a href="/">board</a> · <a href="/retro">retro</a></span></header>
    <div class="sub">${r.totalItems} work items · ${r.totalEvents} recorded events · ${scopeLine} · generated ${esc(r.generatedAt)}</div>
    <div class="grid">
      <div class="panel">
        <h2>Claim accuracy — agent self-assertion vs verified ground truth</h2>
        <div class="big ${c.accuracy >= 0.8 ? "good" : "warn"}">${pct(c.accuracy)}</div>
        <div class="kv">claims posted: <b>${c.totalClaims}</b> · optimistic when posted: <b>${c.aheadWhenPosted}</b></div>
        <div class="kv">eventually substantiated: <b>${c.substantiated}/${c.totalClaims}</b> · currently claimed-not-verified: <b>${c.currentlyClaimedNotVerified}</b></div>
      </div>
      <div class="panel">
        <h2>Delivery funnel — current verified state</h2>
        ${funnel}
      </div>
      <div class="panel">
        <h2>Cycle time per verified state — where work waits</h2>
        ${timings}
      </div>
      <div class="panel">
        <h2>Gate effectiveness — declared vs satisfied by ground truth</h2>
        ${gates}
      </div>
      <div class="panel">
        <h2>Flags raised</h2>
        <div class="mrow"><span class="mlabel">out-of-bounds</span><span class="mval">${r.flags.outOfBounds}</span></div>
        <div class="mrow"><span class="mlabel">claimed-not-verified</span><span class="mval">${r.flags.claimedNotVerified}</span></div>
      </div>
    </div>
  </body></html>`;
}

createServer((req, res) => {
  const store = new RecordStore(DB); // re-read each request for a live view
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if ((req.url ?? "/").startsWith("/retro")) {
    const q = (req.url ?? "").split("?")[1] ?? "";
    const intent = new URLSearchParams(q).get("intent") ?? undefined;
    res.end(renderRetro(store, intent));
    return;
  }
  const items = project(store);
  const eventsByItem = new Map<string, RecordEvent[]>();
  for (const it of items) eventsByItem.set(it.id, store.forItem(it.id));
  const autoRefresh = !/[?&]refresh=off\b/.test(req.url ?? "");
  res.end(render(items, eventsByItem, autoRefresh));
}).listen(PORT, () => {
  console.log(`[adr-board] http://localhost:${PORT}  (record=${DB})`);
});
