import { mountInterface, describeFinding, describeCollection, describeDashboardCard, emptyCollectionMessage } from "./ui-client.mjs";

export { emptyCollectionMessage } from "./ui-client.mjs";

export function renderPage({ token, nonce }) {
    return `<!doctype html>
<html lang="en" data-color-mode="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Repo Health · Review &amp; Take Action</title>
<style>
:root { color-scheme: light dark; --surface: var(--background-color-default, #fff); --ink: var(--text-color-default, #1f2328); --muted: var(--text-color-muted, #59636e); --line: var(--border-color-default, #d1d9e0); --accent: var(--true-color-blue, #0969da); --accent-soft: var(--true-color-blue-muted, #ddf4ff); --danger: var(--true-color-red, #b42318); }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--surface); color: var(--ink); font-family: var(--font-sans, system-ui, sans-serif); font-size: var(--text-body-medium, 14px); line-height: 1.5; }
button, select, input, textarea { font: inherit; color: inherit; }
button, select, input, textarea, summary, a { touch-action: manipulation; }
button, select, input, textarea { border: 1px solid var(--line); background: var(--surface); border-radius: 8px; padding: 9px 12px; min-height: 40px; }
button { cursor: pointer; font-weight: var(--font-weight-semibold, 600); }
button:hover:not(:disabled), summary:hover { background: color-mix(in srgb, var(--ink) 5%, var(--surface)); }
button:disabled { cursor: not-allowed; opacity: .6; }
:is(button, select, input, textarea, a, summary):focus-visible { outline: 3px solid var(--color-focus-outline, #0969da); outline-offset: 3px; }
a { color: var(--accent); text-underline-offset: 3px; }
h1,h2,h3,p { margin: 0; }
h1 { font-size: clamp(24px, 3vw, 32px); line-height: 1.2; letter-spacing: -.035em; text-wrap: balance; }
h2 { font-size: 18px; line-height: 1.35; letter-spacing: -.02em; text-wrap: balance; }
h3 { font-size: 15px; }
code, pre { font-family: var(--font-mono, monospace); font-size: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; padding: 14px; border-radius: 8px; background: color-mix(in srgb, var(--ink) 4%, var(--surface)); }
.app { container-type: inline-size; width: 100%; max-width: 1200px; margin: auto; padding: 24px clamp(16px, 3vw, 40px) 36px; }
.skip { position: absolute; top: -80px; left: 16px; padding: 12px; background: var(--surface); z-index: 3; }
.skip:focus { top: 8px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.between { justify-content: space-between; }
.eyebrow { font-size: 11px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.muted, .hint { color: var(--muted); }
.hint { font-size: 12px; line-height: 1.55; }
.intro { margin-top: 10px; max-width: 70ch; color: var(--muted); }
.badge { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 99px; padding: 3px 9px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.badge.accent { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 25%, var(--line)); background: var(--accent-soft); }
.badge.attention { color: var(--danger); background: var(--true-color-red-muted, #fff1f0); border-color: color-mix(in srgb, var(--danger) 25%, var(--line)); }
.badge.unknown { color: var(--muted); background: color-mix(in srgb, var(--ink) 4%, var(--surface)); }
.control { display: grid; gap: 6px; min-width: 0; }
.control > label, .field { font-size: 12px; font-weight: 600; }
select, input, textarea { width: 100%; min-width: 0; }
.primary { color: var(--color-white, #fff); background: var(--accent); border-color: var(--accent); }
.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 88%, black); }
.meta { display: flex; gap: 6px 20px; flex-wrap: wrap; color: var(--muted); font-size: 12px; margin: 10px 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.status { font-size: 12px; margin: 10px 0 20px; min-height: 18px; color: var(--muted); }
.status.error { color: var(--danger); }
.overview { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-bottom: 24px; }
.overview-title { padding: 18px 20px 14px; }
.overview-title p { margin-top: 5px; }
.metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line); }
.metric { padding: 16px 20px; }
.metric + .metric { border-left: 1px solid var(--line); }
.metric strong { display: block; font-size: 24px; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.metric span { font-size: 12px; color: var(--muted); }
.section-head { margin: 0 0 14px; }
.section-head p { margin-top: 5px; }
.group { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
.group-head { padding: 16px; border-bottom: 1px solid var(--line); }
.group-head p { margin-top: 5px; }
.finding-list { display: grid; }
.finding { border: 0; border-radius: 0; width: 100%; padding: 16px; text-align: left; min-width: 0; background: transparent; position: relative; content-visibility: auto; contain-intrinsic-size: auto 110px; }
.finding + .finding { border-top: 1px solid var(--line); }
.finding[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 7%, var(--surface)); box-shadow: inset 3px 0 var(--accent); }
.finding .row { align-items: start; }
.finding strong { font-size: 14px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.finding p { color: var(--muted); font-size: 12px; line-height: 1.6; margin-top: 7px; font-weight: 400; overflow-wrap: anywhere; }
.finding .record-meta { font-size: 11px; margin-top: 8px; }
.empty { padding: 18px 16px; font-size: 13px; color: var(--muted); }
.coverage { padding: 10px 16px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
.action-panel { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.action-header { padding: 18px 20px; border-bottom: 1px solid var(--line); }
.action-body { padding: 20px; }
.empty-action { padding: 30px 22px; text-align: center; }
.empty-action .symbol { font-size: 24px; color: var(--accent); margin-bottom: 10px; }
.empty-action p { margin-top: 8px; }
.selected-title { margin-bottom: 10px; overflow-wrap: anywhere; }
.selected-summary { margin: 12px 0; color: var(--muted); font-size: 13px; }
.facts { display: grid; gap: 10px; margin: 16px 0; }
.fact { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 10px; font-size: 12px; overflow-wrap: anywhere; }
.fact dt { color: var(--muted); }
.fact dd { margin: 0; }
.next-step { padding: 12px 14px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 5%, var(--surface)); font-size: 12px; margin: 16px 0; }
details { border-top: 1px solid var(--line); padding: 12px 0; }
summary { cursor: pointer; font-size: 12px; font-weight: 600; border-radius: 4px; padding: 5px 0; }
details > :not(summary) { margin-top: 10px; }
.brief-heading { border-top: 1px solid var(--line); padding-top: 20px; margin: 8px 0 14px; }
form { display: grid; gap: 14px; }
.field { display: grid; gap: 6px; }
.field .hint { font-weight: 400; }
textarea { min-height: 76px; resize: vertical; font-weight: 400; }
input { font-weight: 400; }
.handoff { border-top: 1px solid var(--line); margin-top: 20px; padding-top: 16px; }
.handoff textarea { min-height: 130px; margin: 10px 0; font-size: 12px; }
.progress { margin-top: 18px; }
.progress .row { flex-wrap: nowrap; }
.progress select { flex: 1; }
.progress button { flex-shrink: 0; }
.coverage-panel { border: 1px solid var(--line); border-radius: 12px; padding: 6px 18px; margin-top: 24px; }
.coverage-panel > details:first-child { border-top: 0; }
.note { font-size: 12px; color: var(--muted); padding: 7px 0; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
#reviewHeading { scroll-margin-top: 20px; }
#reviewHeading:focus-visible { outline: 3px solid var(--color-focus-outline, #0969da); outline-offset: 5px; }
@container (max-width: 440px) { .metric { padding: 12px; } .metric strong { font-size: 21px; } .metric span { font-size: 11px; } .action-body { padding: 16px; } .fact { grid-template-columns: 75px minmax(0, 1fr); } .badge { white-space: normal; } }
@media (max-width: 850px) { .app { padding-top: 20px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
.compact-header { padding-bottom: 18px; border-bottom: 1px solid var(--line); margin-bottom: 22px; }
.compact-header h1 { font-size: 23px; }
.header-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; position: relative; }
.sample-widget { border: 0; padding: 0; }
.sample-widget summary { color: var(--accent); border: 1px solid var(--line); border-radius: 99px; padding: 5px 10px; font-size: 11px; }
.widget-content { position: absolute; right: 0; top: 100%; width: min(300px, 75vw); max-width: 100%; padding: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); z-index: 4; box-shadow: 0 8px 24px #00000014; }
.widget-content .control + .control { margin-top: 12px; }
.repository-control { max-width: 340px; margin-top: 12px; }
.dashboard-intro { margin-bottom: 18px; }
.dashboard-intro h2 { font-size: 22px; }
.dashboard-intro p { margin-top: 6px; }
.dashboard-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.dashboard-card { display: flex; flex-direction: column; align-items: start; text-align: left; padding: 20px; min-height: 180px; border-radius: 12px; }
.dashboard-card:hover { border-color: var(--accent); }
.dashboard-card .card-title { font-size: 14px; }
.dashboard-card .card-value { font-size: 30px; letter-spacing: -.04em; font-variant-numeric: tabular-nums; margin: 12px 0 4px; }
.dashboard-card .card-description { font-size: 12px; color: var(--muted); font-weight: 400; flex: 1; }
.dashboard-card .card-bottom { width: 100%; margin-top: 16px; }
.dashboard-card .arrow { color: var(--accent); }
.dashboard-foot { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; font-size: 12px; color: var(--muted); }
.dashboard-foot button { font-size: 12px; min-height: 32px; padding: 5px 10px; }
.navigation { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; color: var(--muted); font-size: 12px; flex-wrap: wrap; }
.navigation button { border: 0; min-height: 32px; padding: 4px 8px; color: var(--accent); }
.workspace { display: block; }
.action-panel { position: static; max-width: 760px; margin: auto; }
.action-header { border: 0; padding-bottom: 0; }
.group { max-width: 860px; margin: auto; }
.overview { margin: 0 0 18px; }
.status { margin: 8px 0 0; min-height: 0; }
.compact-header .hint { margin-top: 6px; }
.brief-disclosure { margin-top: 18px; }
.brief-disclosure > summary { color: var(--accent); font-size: 14px; }
.brief-disclosure .brief-heading { border: 0; padding-top: 6px; }
@container (max-width: 480px) { .dashboard-cards { grid-template-columns: 1fr; } .dashboard-card { min-height: 150px; padding: 16px; } .header-actions { gap: 6px; } .compact-header > .row { align-items: start; } }
</style>
</head>
<body>
<a href="#dashboardHeading" class="skip">Skip to Dashboard</a>
<div class="app">
<header class="compact-header">
<div class="row between"><h1>Repo Health</h1><div class="header-actions">
<details id="sampleWidget" class="sample-widget" hidden><summary>Sample data</summary><div class="widget-content"><p class="hint">Fixture mode · No live repository data.</p><div class="control"><label id="fixtureLabel" for="fixture">Scenario</label><select id="fixture" name="fixture"></select></div></div></details>
<details id="sourceSettings" class="sample-widget"><summary>Data source</summary><div class="widget-content"><div class="control"><label for="mode">Data Source</label><select id="mode" name="mode"><option value="live">Live</option><option value="fixture">Fixture</option></select></div><p class="hint">Live requires an explicitly approved repository and account.</p></div></details>
<button id="refresh" class="primary" type="button">Refresh</button></div></div>
<div class="row" id="repositoryContext"></div>
<p id="headerMeta" class="hint"></p>
<div id="repositoryControl" class="control repository-control" hidden><label id="repositoryLabel" for="repository">Repository</label><select id="repository" name="repository"></select></div>
<span id="modeBadge" hidden></span>
<p id="status" class="status" role="status" aria-live="polite">Loading repository evidence…</p>
</header>
<main>
<section id="dashboard" aria-labelledby="dashboardHeading">
<div class="dashboard-intro"><h2 id="dashboardHeading" tabindex="-1">At a Glance</h2><p id="dashboardSummary" class="hint">Refresh to collect repository evidence.</p></div>
<div id="dashboardCards" class="dashboard-cards"></div>
<div class="dashboard-foot"><button id="showCoverage" type="button">Scope &amp; Collection Details</button><span>Read-only evidence. No automatic changes.</span></div>
</section>
<div id="drilldown" hidden>
<nav class="navigation" aria-label="Dashboard navigation"><button id="backDashboard" type="button">← Dashboard</button><span id="categorySeparator" hidden>/</span><button id="backCategory" type="button" hidden>Findings</button><span id="currentViewLabel"></span></nav>
<section id="coverageView" hidden>
<div class="section-head"><h2 tabindex="-1">Scope &amp; Collection Details</h2></div>
<section class="overview" aria-labelledby="overviewHeading">
<div class="overview-title"><h2 id="overviewHeading">Evidence Coverage</h2><p id="overviewText" class="hint">Selected repository only.</p></div>
<div class="metrics"><div class="metric"><strong id="reviewCount">—</strong><span>Items to review</span></div><div class="metric"><strong id="unavailableCount">—</strong><span>Unavailable PR / alert sources</span></div><div class="metric"><strong id="coverageCount">—</strong><span>Complete PR / alert collections</span></div></div>
</section>
<div id="scanMeta" class="meta"></div>
<section class="coverage-panel" aria-label="Scope and policy details">
<details open><summary id="limitationsHeading">Scope &amp; Limitations</summary><p class="hint">Unavailable data does not mean zero findings. Source states do not confirm repository-wide safety or a verified fix.</p><div id="limitations"></div></details>
<details><summary>Policy &amp; Collection Details</summary><div id="policyMeta"></div></details>
</section>
</section>
<div class="workspace">
<section id="findings" aria-labelledby="findingsHeading" hidden>
<div class="section-head"><h2 id="findingsHeading" tabindex="-1">Findings</h2></div>
<div class="group" data-category="standards"><div class="group-head"><p class="hint">Ownership and license evidence.</p></div><div id="standards" class="finding-list"></div></div>
<div class="group" data-category="dependency-pr"><div class="group-head"><p class="hint">Open updates from configured dependency-bot identities.</p></div><div id="dependencyPrs" class="finding-list"></div></div>
<div class="group" data-category="dependency-alert"><div class="group-head"><p class="hint">Advisory evidence, separate from pull-request activity.</p></div><div id="dependencyAlerts" class="finding-list"></div></div>
<div class="group" data-category="code-alert"><div class="group-head"><p class="hint">Existing code-scanning alerts only.</p></div><div id="codeAlerts" class="finding-list"></div></div>
</section>
<section id="actionPanel" class="action-panel" aria-labelledby="reviewHeading" hidden>
<div class="action-header"><h2 id="reviewHeading" tabindex="-1">Finding Details</h2></div>
<div id="noSelection" class="empty-action"><div class="symbol" aria-hidden="true">↖</div><h3>Start With a Finding</h3><p class="hint">Select an item from the findings list. Its evidence, existing remediation, and next step will appear here.</p><p class="hint">Preparing a brief saves a draft only. It never dispatches an agent.</p></div>
<div id="selection" class="action-body" hidden>
<div id="findingDetails"></div>
<details id="technicalDetails"><summary>Technical Evidence</summary><pre id="technicalEvidence"></pre></details>
<details id="briefDisclosure" class="brief-disclosure"><summary>Prepare an Action Brief</summary>
<div class="brief-heading"><p class="hint">Edit the suggested scope. Save a handoff for a separately authorized task.</p></div>
<form id="briefForm" autocomplete="off">
<label class="field">Requested Task<input name="requestedTask" maxlength="800" required autocomplete="off"></label>
<label class="field">Target Branch or Revision<input name="targetRef" maxlength="200" required autocomplete="off" spellcheck="false"><span class="hint">Confirm the revision before making any change.</span></label>
<label class="field">Allowed Scope<textarea name="allowedScope" maxlength="800" required autocomplete="off"></textarea></label>
<label class="field">Constraints<textarea name="constraints" maxlength="1000" required autocomplete="off"></textarea></label>
<label class="field">Completion Criteria<textarea name="completionCriteria" maxlength="800" required autocomplete="off"></textarea></label>
<p id="briefError" class="status error" role="status" aria-live="polite" hidden></p>
<button id="prepareButton" class="primary" type="submit">Save Action Brief</button>
<p id="draftStatus" class="hint">Draft only · No agent dispatch · No GitHub writes</p>
</form>
<div id="handoffSection" class="handoff" hidden><label class="field" for="handoff">Saved Handoff <span class="hint">Copy this into a separate task when you are ready.</span></label><textarea id="handoff" readonly></textarea><button id="copyHandoff" type="button">Copy Handoff</button></div>
</details>
<details class="progress"><summary>Track Work Progress</summary><p class="hint">Your notes about the work, not the source assessment. Saving progress cannot verify a resolution.</p><div class="row"><label for="progress" class="sr-only">Work Progress</label><select id="progress" name="progress"><option value="needs-attention">Not started</option><option value="investigating">Investigating</option><option value="change-proposed">Change proposed</option><option value="awaiting-review">Awaiting review</option></select><button id="saveProgress" type="button">Save Progress</button></div></details>
</div>
</section>
</div>
</div>
</main>
</div>
<script nonce="${nonce}">
${emptyCollectionMessage.toString()}
${describeCollection.toString()}
${describeFinding.toString()}
${describeDashboardCard.toString()}
const authToken = ${JSON.stringify(token)};
(${mountInterface.toString()})(authToken);
</script>
</body>
</html>`;
}
