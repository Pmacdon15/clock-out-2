/*
 * The HTML for Clock Out's in-chat apps (MCP Apps, SEP-1865, and the OpenAI
 * Apps SDK). Each page is fully self-contained: inline CSS and JS, no network
 * requests, nothing loaded from outside. The page talks only to the host it is
 * embedded in, and every change it makes goes through the host as an ordinary
 * MCP `tools/call` (update_time_entry, manage_time_off, audit_timesheets, ...),
 * so the server's own sign-in and role checks decide what is allowed, exactly
 * as when the model calls those tools.
 *
 * The client script below is plain ES2019 kept in a string; it must not use
 * template literals (backticks), since it lives inside one.
 */

export type ClockOutView = "timecard" | "hours" | "anomalies";

const STYLES = `
:root {
  color-scheme: light dark;
  --co-bg: #ffffff;
  --co-surface: #f6f7f9;
  --co-border: #e3e6ea;
  --co-text: #14171a;
  --co-muted: #5f6b77;
  --co-accent: #2563eb;
  --co-accent-text: #ffffff;
  --co-bar: #3b82f6;
  --co-bar-ot: #f59e0b;
  --co-bar-off: #10b981;
  --co-danger: #b42318;
  --co-ok: #067647;
  --co-sev-high: #b42318;
  --co-sev-medium: #b54708;
  --co-sev-low: #475467;
  --co-radius: 10px;
  --co-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --co-bg: #16181b; --co-surface: #1f2226; --co-border: #2e3238;
    --co-text: #eceef1; --co-muted: #9aa4af; --co-accent: #60a5fa;
    --co-accent-text: #0b1220; --co-bar: #60a5fa; --co-danger: #f97066; --co-ok: #47cd89;
    --co-sev-high: #f97066; --co-sev-medium: #fdb022; --co-sev-low: #98a2b3;
  }
}
:root[data-theme="dark"] {
  --co-bg: #16181b; --co-surface: #1f2226; --co-border: #2e3238;
  --co-text: #eceef1; --co-muted: #9aa4af; --co-accent: #60a5fa;
  --co-accent-text: #0b1220; --co-bar: #60a5fa; --co-danger: #f97066; --co-ok: #47cd89;
  --co-sev-high: #f97066; --co-sev-medium: #fdb022; --co-sev-low: #98a2b3;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--color-background-primary, var(--co-bg));
  color: var(--color-text-primary, var(--co-text));
  font: 14px/1.45 var(--font-sans, var(--co-font));
}
main { padding: 14px 16px 16px; }
h1 { font-size: 16px; margin: 0; font-weight: 600; }
h2 { font-size: 13px; margin: 18px 0 8px; font-weight: 600; color: var(--co-muted); text-transform: uppercase; letter-spacing: .04em; }
.sub { color: var(--co-muted); font-size: 12.5px; margin-top: 2px; }
.tiles { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.tile { background: var(--co-surface); border: 1px solid var(--co-border); border-radius: var(--co-radius); padding: 8px 12px; min-width: 110px; }
.tile b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.tile span { color: var(--co-muted); font-size: 12px; }
.scroll { overflow-x: auto; margin-top: 12px; border: 1px solid var(--co-border); border-radius: var(--co-radius); }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--co-border); white-space: nowrap; }
th { font-size: 12px; font-weight: 600; color: var(--co-muted); background: var(--co-surface); }
tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; }
td.cell { text-align: center; cursor: pointer; }
td.cell:hover, tr.clickable:hover td { background: var(--co-surface); }
td.cell.sel { outline: 2px solid var(--co-accent); outline-offset: -2px; }
td.empty { color: var(--co-muted); }
tr.clickable { cursor: pointer; }
.muted { color: var(--co-muted); }
.badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--co-border); color: var(--co-muted); margin-left: 4px; }
.badge.live { color: var(--co-ok); border-color: currentColor; }
.panel { margin-top: 12px; border: 1px solid var(--co-border); border-radius: var(--co-radius); padding: 10px 12px; background: var(--co-surface); }
.shift { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--co-border); }
.shift:last-child { border-bottom: 0; }
.shift .t { min-width: 150px; font-variant-numeric: tabular-nums; }
.grow { flex: 1; }
button { font: inherit; font-size: 13px; border-radius: 8px; border: 1px solid var(--co-border); background: var(--co-bg); color: inherit; padding: 4px 10px; cursor: pointer; }
button.primary { background: var(--co-accent); border-color: var(--co-accent); color: var(--co-accent-text); }
button.danger { color: var(--co-danger); }
button:disabled { opacity: .55; cursor: default; }
input[type="time"], input[type="date"] { font: inherit; font-size: 13px; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--co-border); background: var(--co-bg); color: inherit; }
label.inline { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; }
.edit { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; width: 100%; padding: 6px 0 2px; }
.status { margin-top: 10px; font-size: 13px; min-height: 1em; }
.status.err { color: var(--co-danger); }
.status.ok { color: var(--co-ok); }
.bars { margin-top: 12px; display: grid; grid-template-columns: minmax(80px, 160px) 1fr auto; gap: 6px 10px; align-items: center; }
.bar { height: 14px; border-radius: 4px; background: var(--co-surface); border: 1px solid var(--co-border); overflow: hidden; display: flex; }
.bar i { display: block; height: 100%; }
.bar i.reg { background: var(--co-bar); }
.bar i.ot { background: var(--co-bar-ot); }
.bar i.off { background: var(--co-bar-off); }
.legend { display: flex; gap: 12px; font-size: 12px; color: var(--co-muted); margin-top: 6px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.empty-state { padding: 24px 0; text-align: center; color: var(--co-muted); }
.sev { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; text-transform: capitalize; }
.sev.high { color: var(--co-sev-high); }
.sev.medium { color: var(--co-sev-medium); }
.sev.low { color: var(--co-sev-low); }
.tile.high b { color: var(--co-sev-high); }
.tile.medium b { color: var(--co-sev-medium); }
.tile.low b { color: var(--co-sev-low); }
.filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 12px; }
.filters button.on { border-color: var(--co-accent); color: var(--co-accent); }
select { font: inherit; font-size: 13px; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--co-border); background: var(--co-bg); color: inherit; }
.finding { margin-top: 8px; border: 1px solid var(--co-border); border-radius: var(--co-radius); padding: 10px 12px; }
.finding .top { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.finding .desc { margin-top: 6px; }
.finding .note { margin-top: 4px; font-size: 12.5px; color: var(--co-muted); }
.finding .fix { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
.confirm { width: 100%; margin-top: 4px; padding: 8px 10px; border-radius: 8px; background: var(--co-surface); border: 1px solid var(--co-border); }
.confirm ul { margin: 4px 0 8px; padding-left: 18px; }
.check { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--co-border); }
.check:last-child { border-bottom: 0; }
.check .badge { justify-self: end; align-self: start; margin-left: 0; }
.check .note { grid-column: 1 / -1; font-size: 12.5px; color: var(--co-muted); }
`;

const SCRIPT = `
(function () {
  "use strict";
  var VIEW = document.documentElement.getAttribute("data-view");
  var SOURCE_TOOL = VIEW === "hours" ? "run_hours_report" : VIEW === "anomalies" ? "audit_timesheets" : "get_weekly_timecard";
  var root = document.getElementById("app");
  var state = { data: null, sel: null, editing: null, busy: false, msg: null, pending: null, sev: "all", type: "all", confirming: null };

  /* ---------- host bridge: MCP Apps (postMessage JSON-RPC) or OpenAI Apps SDK ---------- */
  var openai = window.openai || null;
  var nextId = 1;
  var waiting = {};
  function post(msg) { if (window.parent && window.parent !== window) window.parent.postMessage(msg, "*"); }
  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (resolve, reject) {
      waiting[id] = { resolve: resolve, reject: reject };
      setTimeout(function () {
        if (waiting[id]) { delete waiting[id]; reject(new Error("The chat app did not answer in time.")); }
      }, 30000);
    });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function callTool(name, args) {
    if (openai && typeof openai.callTool === "function") return openai.callTool(name, args);
    return request("tools/call", { name: name, arguments: args });
  }
  function resultText(res) {
    var c = res && res.content;
    if (c && c.length && c[0] && typeof c[0].text === "string") return c[0].text;
    return "";
  }
  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  }
  function applyHostContext(ctx) {
    if (!ctx) return;
    applyTheme(ctx.theme);
    var vars = ctx.styles && ctx.styles.variables;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        if (/^--[a-z0-9-]+$/i.test(k) && typeof vars[k] === "string") document.documentElement.style.setProperty(k, vars[k]);
      });
    }
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var m = event.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && m.id !== null && !m.method) {
      var w = waiting[m.id];
      if (!w) return;
      delete waiting[m.id];
      if (m.error) w.reject(new Error(m.error.message || "Request failed")); else w.resolve(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") {
      var p = m.params || {};
      if (p.structuredContent) setData(p.structuredContent);
      else if (p.isError) showMessage(resultText(p) || "The tool returned an error.", true);
    } else if (m.method === "ui/notifications/host-context-changed") {
      applyHostContext(m.params);
    } else if (m.method === "ui/resource-teardown" || m.method === "ping") {
      if (m.id !== undefined) post({ jsonrpc: "2.0", id: m.id, result: {} });
    }
  });

  function reportSize() {
    var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (openai && typeof openai.notifyIntrinsicHeight === "function") { try { openai.notifyIntrinsicHeight(h); } catch (e) {} }
    else notify("ui/notifications/size-changed", { height: h });
  }

  function start() {
    if (openai) {
      applyTheme(openai.theme);
      if (openai.toolOutput) setData(openai.toolOutput); else render();
      window.addEventListener("openai:set_globals", function (e) {
        var g = (e && e.detail && e.detail.globals) || {};
        if (g.theme) applyTheme(g.theme);
        if (g.toolOutput) setData(g.toolOutput);
      });
    } else {
      render();
      request("ui/initialize", {
        protocolVersion: "2026-01-26",
        appInfo: { name: "clock-out-" + VIEW, version: "1.0.0" },
        appCapabilities: {}
      }).then(function (res) {
        applyHostContext(res && res.hostContext);
        notify("ui/notifications/initialized", {});
      }).catch(function () { /* not embedded in an MCP Apps host */ });
    }
    if (typeof ResizeObserver === "function") new ResizeObserver(reportSize).observe(document.body);
  }

  /* ---------- helpers ---------- */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "checked" || k === "disabled" || k === "value") el[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
    });
    return el;
  }
  function fmtHours(n) {
    if (typeof n !== "number" || !isFinite(n)) return "–";
    var mins = Math.round(n * 60);
    return Math.floor(mins / 60) + "h " + (mins % 60 < 10 ? "0" : "") + (mins % 60) + "m";
  }
  function localParts(iso) {
    // shift.clock_in_local is "YYYY-MM-DD HH:mm:ss TZ" in the period's timezone
    if (!iso) return null;
    return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
  }
  function addDay(date) {
    var d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(start, end) {
    var out = [];
    var d = start;
    for (var i = 0; d && d <= end && i < 62; i++) { out.push(d); d = addDay(d); }
    return out;
  }
  function weekday(date) {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(date + "T12:00:00Z").getUTCDay()];
  }
  function people(data) { return (data && (data.timecards || data.reports)) || []; }
  function isAdmin() { return Boolean(state.data && state.data.viewer && state.data.viewer.is_admin); }
  function orgArg() { var o = state.data && state.data.organization; return o && o.org_id ? { org_id: o.org_id } : {}; }

  function setData(data) {
    if (!data || typeof data !== "object") return;
    state.data = data;
    state.editing = null;
    state.confirming = null;
    render();
    if (VIEW !== "anomalies" && isAdmin() && data.period && state.pending === null) loadPending();
  }
  function showMessage(text, isErr) { state.msg = { text: text, err: Boolean(isErr) }; render(); }

  /* ---------- actions (all through the host -> MCP tools/call) ---------- */
  function refreshArgs(d) {
    var args = Object.assign({}, orgArg(), {
      start_date: d.period.start_date,
      end_date: d.period.end_date,
      timezone: d.period.timezone
    });
    if (VIEW === "anomalies") {
      // Re-run the same audit: same member, checks and thresholds.
      args.member = d.member && d.member.user_id ? d.member.user_id : "all";
      if (d.requested_checks && d.requested_checks.length) args.checks = d.requested_checks;
      var t = d.thresholds || {};
      THRESHOLD_KEYS.forEach(function (k) { if (typeof t[k] === "number") args[k] = t[k]; });
      return args;
    }
    var list = people(d);
    args.member = d.scope === "member" && list.length === 1 ? list[0].user_id : "all";
    return args;
  }
  function refresh() {
    var d = state.data;
    if (!d || !d.period) return Promise.resolve();
    return callTool(SOURCE_TOOL, refreshArgs(d)).then(function (res) {
      if (res && res.structuredContent && !res.isError) { state.data = res.structuredContent; }
    });
  }
  function run(name, args, okText) {
    if (state.busy) return;
    state.busy = true;
    state.msg = { text: "Saving…", err: false };
    render();
    callTool(name, Object.assign({}, orgArg(), args)).then(function (res) {
      if (res && res.isError) throw new Error(resultText(res) || "Clock Out refused the change.");
      state.editing = null;
      state.confirming = null;
      state.msg = { text: resultText(res) || okText, err: false };
      return Promise.all([refresh(), VIEW !== "anomalies" && isAdmin() ? loadPending() : null]);
    }).catch(function (err) {
      state.msg = { text: (err && err.message) || "Something went wrong.", err: true };
    }).then(function () { state.busy = false; render(); });
  }
  function saveEdit(shift, form) {
    var date = form.date.value;
    var inT = form.clockIn.value;
    var outT = form.clockOut.value;
    if (!date || !inT) { showMessage("Pick a date and a clock-in time.", true); return; }
    var args = {
      entry_id: shift.id,
      date: date,
      clock_in: date + " " + inT,
      timezone: state.data.period.timezone,
      skip_lunch: form.skipLunch.checked
    };
    if (outT) args.clock_out = (outT <= inT ? addDay(date) : date) + " " + outT;
    run("update_time_entry", args, "Shift updated.");
  }
  function loadPending() {
    var d = state.data;
    if (!d || !d.period) return Promise.resolve();
    return callTool("manage_time_off", Object.assign({}, orgArg(), {
      action: "list", status: "pending", start_date: d.period.start_date
    })).then(function (res) {
      var sc = res && !res.isError && res.structuredContent;
      var reqs = (sc && sc.requests) || [];
      var end = d.period.end_date;
      var ids = {};
      people(d).forEach(function (p) { ids[p.user_id] = true; });
      state.pending = reqs.filter(function (r) { return r.start_date <= end && ids[r.user_id]; });
      render();
    }).catch(function () { state.pending = []; render(); });
  }

  /* ---------- the timesheet anomalies card (audit_timesheets) ---------- */
  var THRESHOLD_KEYS = ["long_shift_hours", "missed_clock_out_hours", "meal_break_after_hours", "meal_break_min_minutes", "max_distance_meters", "edit_grace_minutes", "late_grace_minutes"];
  var SEVERITIES = ["high", "medium", "low"];
  var TYPE_LABELS = {
    missed_clock_out: "Missed clock-out",
    long_shift: "Long shift",
    overlapping_entries: "Overlapping entries",
    missed_meal_break: "Missed meal break",
    punch_far_from_site: "Punch far from site",
    suspicious_location: "Suspicious location",
    edited_after_the_fact: "Edited after the fact",
    late_arrival: "Late arrival",
    no_show: "No-show"
  };
  function typeLabel(t) { return TYPE_LABELS[t] || String(t || "").replace(/_/g, " "); }
  function findingKey(f) { return f.type + ":" + (f.entry_ids || []).join(","); }
  function sevRank(s) { var i = SEVERITIES.indexOf(s); return i < 0 ? 9 : i; }
  function findings(d) { return (d && d.findings) || []; }
  function auditCounts(d) {
    var c = (d.counts && d.counts.by_severity) || {};
    var out = {};
    SEVERITIES.forEach(function (s) {
      out[s] = typeof c[s] === "number" ? c[s] : findings(d).filter(function (f) { return f.severity === s; }).length;
    });
    return out;
  }
  function fixLines(fix) {
    var lines = [];
    if (fix.clock_in) lines.push("Clock in: " + fix.clock_in);
    if (fix.clock_out) lines.push("Clock out: " + fix.clock_out);
    if (typeof fix.skip_lunch === "boolean") lines.push(fix.skip_lunch ? "Mark as skipped lunch (no lunch deduction)" : "Clear the skipped-lunch flag (lunch deduction applies)");
    if (fix.timezone) lines.push("Timezone: " + fix.timezone);
    return lines;
  }
  function anomaliesHeader(d) {
    var title = "Timesheet anomalies" + (d.member && d.member.name ? " · " + d.member.name : "");
    var sub = [d.organization && d.organization.name, d.period && d.period.label, d.period && d.period.timezone].filter(Boolean).join(" · ");
    var counts = auditCounts(d);
    var total = d.counts && typeof d.counts.total === "number" ? d.counts.total : findings(d).length;
    var items = [
      h("div", { class: "tile" }, [h("b", null, [String(total)]), h("span", null, [total === 1 ? "Finding" : "Findings"])]),
      h("div", { class: "tile" }, [h("b", null, [String(d.entries_audited || 0)]), h("span", null, ["Entries audited"])])
    ].concat(SEVERITIES.map(function (s) {
      return h("div", { class: "tile " + s }, [h("b", null, [String(counts[s])]), h("span", null, [s.charAt(0).toUpperCase() + s.slice(1)])]);
    }));
    return h("div", null, [h("h1", null, [title]), h("div", { class: "sub" }, [sub]), h("div", { class: "tiles" }, items)]);
  }
  function anomaliesFilters(d) {
    var list = findings(d);
    var counts = auditCounts(d);
    var sevButtons = ["all"].concat(SEVERITIES).map(function (s) {
      var n = s === "all" ? list.length : counts[s];
      return h("button", {
        class: state.sev === s ? "on" : null,
        "aria-pressed": state.sev === s ? "true" : "false",
        onclick: function () { state.sev = s; render(); }
      }, [(s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)) + " (" + n + ")"]);
    });
    var byType = {};
    list.forEach(function (f) { byType[f.type] = (byType[f.type] || 0) + 1; });
    var select = h("select", {
      "aria-label": "Filter by type",
      onchange: function (e) { state.type = e.target.value; render(); }
    }, [h("option", { value: "all" }, ["All types"])].concat(Object.keys(byType).map(function (t) {
      return h("option", { value: t }, [typeLabel(t) + " (" + byType[t] + ")"]);
    })));
    select.value = byType[state.type] ? state.type : "all";
    return h("div", { class: "filters" }, sevButtons.concat([select]));
  }
  function findingRow(f) {
    var key = findingKey(f);
    var confirming = state.confirming === key;
    var ids = (f.entry_ids || []).map(function (id) { return "#" + id; }).join(", ");
    var node = h("div", { class: "finding" }, [
      h("div", { class: "top" }, [
        h("span", { class: "sev " + f.severity }, [f.severity]),
        h("b", null, [typeLabel(f.type)]),
        h("span", null, [(f.employee && f.employee.name) || "Unknown member"]),
        h("span", { class: "muted" }, [f.date]),
        ids ? h("span", { class: "muted" }, [(f.entry_ids.length === 1 ? "Entry " : "Entries ") + ids]) : null,
        typeof f.scheduled_shift_id === "number" ? h("span", { class: "muted" }, ["Scheduled shift #" + f.scheduled_shift_id]) : null
      ]),
      h("div", { class: "desc" }, [f.description]),
      f.fix_note ? h("div", { class: "note" }, [f.fix_note]) : null
    ]);
    if (!f.suggested_fix) return node;
    var fixBox = h("div", { class: "fix" });
    if (!confirming) {
      fixBox.appendChild(h("button", {
        disabled: state.busy,
        onclick: function () { state.confirming = key; state.msg = null; render(); }
      }, ["Apply fix…"]));
    } else {
      fixBox.appendChild(h("div", { class: "confirm", role: "group", "aria-label": "Confirm fix" }, [
        h("div", null, ["Update entry #" + f.suggested_fix.entry_id + " for " + ((f.employee && f.employee.name) || "this member") + ":"]),
        h("ul", null, fixLines(f.suggested_fix).map(function (l) { return h("li", null, [l]); })),
        h("div", { class: "fix" }, [
          h("button", { onclick: function () { state.confirming = null; render(); } }, ["Cancel"]),
          h("button", {
            class: "primary",
            disabled: state.busy,
            onclick: function () { run("update_time_entry", f.suggested_fix, "Fix applied."); }
          }, ["Confirm fix"])
        ])
      ]));
    }
    node.appendChild(fixBox);
    return node;
  }
  function checksSection(d) {
    var checks = d.checks || [];
    if (!checks.length) return null;
    return h("div", null, [
      h("h2", null, ["Checks"]),
      h("div", { class: "panel" }, checks.map(function (c) {
        return h("div", { class: "check" }, [
          h("span", { class: "t" }, [typeLabel(c.type)]),
          h("span", { class: "badge" + (c.status === "ran" ? " live" : "") }, [c.status === "ran" ? "ran" : "skipped"]),
          c.note ? h("span", { class: "note" }, [c.note]) : null
        ]);
      }))
    ]);
  }
  function renderAnomalies(d) {
    var list = findings(d);
    var nodes = [anomaliesHeader(d)];
    if (!list.length) {
      nodes.push(h("div", { class: "empty-state" }, [
        h("b", null, ["No issues found"]),
        h("div", null, [(d.period && d.period.label ? d.period.label + " · " : "") + (d.entries_audited || 0) + " " + (d.entries_audited === 1 ? "entry" : "entries") + " audited"])
      ]));
    } else {
      nodes.push(anomaliesFilters(d));
      var shown = list.filter(function (f) {
        return (state.sev === "all" || f.severity === state.sev) && (state.type === "all" || f.type === state.type);
      }).map(function (f, i) { return { f: f, i: i }; }).sort(function (a, b) {
        return sevRank(a.f.severity) - sevRank(b.f.severity) || a.i - b.i;
      });
      if (shown.length) nodes = nodes.concat(shown.map(function (x) { return findingRow(x.f); }));
      else nodes.push(h("div", { class: "empty-state" }, ["No findings match these filters."]));
      nodes.push(h("div", { class: "muted", style: "font-size:12px;margin-top:8px" }, ["Fixes are applied to Clock Out only after you confirm them, then the audit runs again."]));
    }
    nodes.push(checksSection(d));
    return nodes;
  }

  /* ---------- rendering ---------- */
  function header(d) {
    var title = VIEW === "hours" ? "Hours report" : (people(d).length === 1 ? "Timecard · " + people(d)[0].name : "Weekly timecard");
    var sub = [d.organization && d.organization.name, d.period && d.period.label, d.period && d.period.timezone].filter(Boolean).join(" · ");
    return h("div", null, [h("h1", null, [title]), h("div", { class: "sub" }, [sub])]);
  }
  function tiles(d) {
    var list = people(d);
    var ot = 0, off = 0, hasOt = false;
    list.forEach(function (p) {
      if (typeof p.overtime_hours === "number") { hasOt = true; ot += p.overtime_hours; }
      if (typeof p.time_off_hours === "number") off += p.time_off_hours;
    });
    var items = [
      [fmtHours(d.organization_total_hours), VIEW === "hours" && d.hours_are_net_of_breaks ? "Net hours" : "Total hours"],
      [String(list.length), list.length === 1 ? "Member" : "Members"]
    ];
    if (hasOt) items.push([fmtHours(ot), "Overtime"]);
    if (off > 0) items.push([fmtHours(off), "Time off"]);
    return h("div", { class: "tiles" }, items.map(function (t) { return h("div", { class: "tile" }, [h("b", null, [t[0]]), h("span", null, [t[1]])]); }));
  }
  function dayMap(p) {
    var m = {};
    (p.daily_breakdown || []).forEach(function (day) { m[day.date] = day; });
    return m;
  }
  function timecardGrid(d) {
    var days = daysBetween(d.period.start_date, d.period.end_date);
    var head = h("tr", null, [h("th", null, ["Member"])].concat(days.map(function (day) {
      return h("th", { class: "num" }, [weekday(day) + " " + day.slice(5)]);
    })).concat([h("th", { class: "num" }, ["Total"])]));
    var rows = people(d).map(function (p) {
      var dm = dayMap(p);
      var cells = days.map(function (day) {
        var entry = dm[day];
        var selected = state.sel && state.sel.user === p.user_id && state.sel.date === day;
        return h("td", {
          class: "cell" + (entry ? "" : " empty") + (selected ? " sel" : ""),
          title: entry ? entry.shifts.length + " shift(s)" : "No shifts",
          onclick: function () { state.sel = selected ? null : { user: p.user_id, date: day }; state.editing = null; render(); }
        }, [entry ? fmtHours(entry.total_hours) : "–"]);
      });
      return h("tr", null, [h("td", null, [p.name, p.active_shifts ? h("span", { class: "badge live" }, ["on shift"]) : null])]
        .concat(cells).concat([h("td", { class: "num" }, [h("b", null, [fmtHours(p.total_hours)])])]));
    });
    return h("div", { class: "scroll" }, [h("table", null, [h("thead", null, [head]), h("tbody", null, rows)])]);
  }
  function hoursChart(d) {
    var list = people(d);
    var max = 0;
    list.forEach(function (p) { max = Math.max(max, (p.total_hours || 0) + (p.time_off_hours || 0)); });
    if (max <= 0) max = 1;
    var grid = [];
    list.forEach(function (p) {
      var ot = typeof p.overtime_hours === "number" ? p.overtime_hours : 0;
      var reg = Math.max(0, (p.total_hours || 0) - ot);
      var off = p.time_off_hours || 0;
      grid.push(h("div", null, [p.name]));
      grid.push(h("div", { class: "bar", role: "img", "aria-label": p.name + ": " + fmtHours(p.total_hours) }, [
        h("i", { class: "reg", style: "width:" + (100 * reg / max) + "%" }),
        ot ? h("i", { class: "ot", style: "width:" + (100 * ot / max) + "%" }) : null,
        off ? h("i", { class: "off", style: "width:" + (100 * off / max) + "%" }) : null
      ]));
      grid.push(h("div", { class: "num" }, [fmtHours(p.total_hours)]));
    });
    return h("div", null, [
      h("div", { class: "bars" }, grid),
      h("div", { class: "legend" }, [
        h("span", null, [h("i", { style: "background:var(--co-bar)" }), "Regular"]),
        h("span", null, [h("i", { style: "background:var(--co-bar-ot)" }), "Overtime"]),
        h("span", null, [h("i", { style: "background:var(--co-bar-off)" }), "Time off"])
      ])
    ]);
  }
  function hoursTable(d) {
    var head = h("tr", null, ["Member", "Net", "Gross", "Breaks", "Overtime", "Time off", "Days"].map(function (t, i) {
      return h("th", { class: i ? "num" : null }, [t]);
    }));
    var rows = people(d).map(function (p) {
      var open = state.sel && state.sel.user === p.user_id && !state.sel.date;
      return h("tr", {
        class: "clickable",
        onclick: function () { state.sel = open ? null : { user: p.user_id }; state.editing = null; render(); }
      }, [
        h("td", null, [(open ? "▾ " : "▸ ") + p.name]),
        h("td", { class: "num" }, [h("b", null, [fmtHours(p.total_hours)])]),
        h("td", { class: "num" }, [fmtHours(p.gross_hours)]),
        h("td", { class: "num" }, [fmtHours(p.break_deduction_hours)]),
        h("td", { class: "num" }, [typeof p.overtime_hours === "number" ? fmtHours(p.overtime_hours) : "–"]),
        h("td", { class: "num" }, [p.time_off_hours ? fmtHours(p.time_off_hours) : "–"]),
        h("td", { class: "num" }, [String(p.days_worked)])
      ]);
    });
    return h("div", { class: "scroll" }, [h("table", null, [h("thead", null, [head]), h("tbody", null, rows)])]);
  }
  function shiftRow(shift) {
    var start = localParts(shift.clock_in_local);
    var end = localParts(shift.clock_out_local);
    var editing = state.editing === shift.id;
    var label = (start ? start.time : "?") + " – " + (end ? end.time : "now");
    var hours = typeof shift.net_hours === "number" ? shift.net_hours : shift.duration_hours;
    var row = h("div", { class: "shift" }, [
      h("span", { class: "t" }, [label, shift.is_active ? h("span", { class: "badge live" }, ["active"]) : null]),
      h("span", null, [fmtHours(hours)]),
      shift.unpaid_break_minutes ? h("span", { class: "muted" }, [shift.unpaid_break_minutes + "m unpaid break"]) : null,
      shift.skip_lunch ? h("span", { class: "badge" }, ["no lunch dock"]) : null,
      h("span", { class: "grow" }),
      isAdmin() && !editing ? h("button", {
        disabled: state.busy,
        onclick: function () { state.editing = shift.id; state.msg = null; render(); }
      }, ["Edit"]) : null
    ]);
    if (editing && start) {
      var form = {
        date: h("input", { type: "date", value: start.date, "aria-label": "Date" }),
        clockIn: h("input", { type: "time", value: start.time, "aria-label": "Clock in" }),
        clockOut: h("input", { type: "time", value: end ? end.time : "", "aria-label": "Clock out" }),
        skipLunch: h("input", { type: "checkbox", checked: Boolean(shift.skip_lunch) })
      };
      row.appendChild(h("div", { class: "edit" }, [
        form.date, form.clockIn, h("span", { class: "muted" }, ["to"]), form.clockOut,
        h("label", { class: "inline" }, [form.skipLunch, "Skipped lunch (don't dock)"]),
        h("span", { class: "grow" }),
        h("button", { onclick: function () { state.editing = null; render(); } }, ["Cancel"]),
        h("button", { class: "primary", disabled: state.busy, onclick: function () { saveEdit(shift, form); } }, ["Save"])
      ]));
    }
    return row;
  }
  function detailPanel(d) {
    if (!state.sel) return null;
    var p = people(d).filter(function (x) { return x.user_id === state.sel.user; })[0];
    if (!p) return null;
    var days = (p.daily_breakdown || []).filter(function (day) { return !state.sel.date || day.date === state.sel.date; });
    var title = p.name + (state.sel.date ? " · " + weekday(state.sel.date) + " " + state.sel.date : "");
    var body = days.length ? days.map(function (day) {
      return h("div", null, [
        state.sel.date ? null : h("div", { class: "muted", style: "margin-top:6px" }, [day.day_of_week + " " + day.date + " · " + fmtHours(day.total_hours)]),
        h("div", null, day.shifts.map(shiftRow))
      ]);
    }) : [h("div", { class: "muted" }, ["No shifts recorded."])];
    var offList = (p.time_off || []).map(function (t) { return h("div", { class: "muted" }, [t.type_label + ": " + t.dates + " (" + fmtHours(t.hours_in_period) + ")"]); });
    return h("div", { class: "panel" }, [h("b", null, [title])].concat(body).concat(offList));
  }
  function pendingPanel() {
    if (!isAdmin() || !state.pending || !state.pending.length) return null;
    return h("div", null, [
      h("h2", null, ["Time off waiting for approval"]),
      h("div", { class: "panel" }, state.pending.map(function (r) {
        return h("div", { class: "shift" }, [
          h("span", { class: "t" }, [r.member]),
          h("span", null, [r.type_label + " · " + r.dates + " · " + fmtHours(r.total_hours)]),
          r.note ? h("span", { class: "muted" }, ["“" + r.note + "”"]) : null,
          h("span", { class: "grow" }),
          h("button", { class: "danger", disabled: state.busy, onclick: function () { run("manage_time_off", { action: "deny", request_id: r.request_id }, "Denied."); } }, ["Deny"]),
          h("button", { class: "primary", disabled: state.busy, onclick: function () { run("manage_time_off", { action: "approve", request_id: r.request_id }, "Approved."); } }, ["Approve"])
        ]);
      }))
    ]);
  }
  function render() {
    var d = state.data;
    var nodes;
    if (!d) nodes = [h("div", { class: "empty-state" }, [VIEW === "anomalies" ? "Auditing timesheets…" : "Loading hours…"])];
    else if (VIEW === "anomalies") nodes = d.period && Array.isArray(d.findings) ? renderAnomalies(d) : [h("div", { class: "empty-state" }, ["No audit results to show for this request."])];
    else if (!d.period || !people(d).length) nodes = [h("div", { class: "empty-state" }, ["No hours to show for this request."])];
    else nodes = [
      header(d), tiles(d),
      VIEW === "hours" ? hoursChart(d) : null,
      VIEW === "hours" ? hoursTable(d) : timecardGrid(d),
      detailPanel(d),
      pendingPanel(),
      h("div", { class: "muted", style: "font-size:12px;margin-top:8px" }, [
        VIEW === "hours" ? "Select a member to see their shifts." : "Select a day to see its shifts.",
        isAdmin() ? " Changes are saved to Clock Out right away." : ""
      ])
    ];
    if (state.msg) nodes.push(h("div", { class: "status " + (state.msg.err ? "err" : "ok"), role: "status" }, [state.msg.text]));
    root.replaceChildren(h("main", null, nodes));
  }

  start();
})();
`;

const TITLES: Record<ClockOutView, string> = {
  timecard: "Clock Out timecard",
  hours: "Clock Out hours report",
  anomalies: "Clock Out timesheet anomalies",
};

/** The complete, self-contained HTML page for one of Clock Out's in-chat apps. */
export function clockOutAppHtml(view: ClockOutView) {
  return `<!doctype html>
<html lang="en" data-view="${view}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLES[view]}</title>
<style>${STYLES}</style>
</head>
<body>
<div id="app"></div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
