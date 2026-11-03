export function emptyCollectionMessage(state, completeness) {
    return state === "available" && completeness === "complete"
        ? "No findings were returned by this complete collection."
        : "No complete results are available; this is not a zero/healthy result.";
}

export function describeCollection(collection) {
    if (collection?.stale) return { label: "Stale evidence", tone: "unknown", message: "Showing earlier evidence. Refresh did not confirm the current state." };
    if (collection?.state === "available") {
        return collection.completeness === "complete"
            ? { label: "Complete", tone: "neutral", message: "All pages within this collection were returned." }
            : { label: "Partial evidence", tone: "unknown", message: "Some results may be missing. A no-match result is not conclusive." };
    }
    if (collection?.state === "not-enabled") return { label: "Not enabled", tone: "unknown", message: "This collection is disabled by the selected policy." };
    if (collection?.state === "policy-denied") return { label: "Access restricted", tone: "unknown", message: "GitHub denied access. Alert counts are unknown, not zero." };
    if (!collection || collection.state === "not-checked") return { label: "Not checked", tone: "unknown", message: "Refresh to collect authorized evidence." };
    return { label: "Unavailable", tone: "unknown", message: "This source could not be read. Its finding count is unknown." };
}

export function describeFinding(finding, standards) {
    if (finding.category === "standards" && finding.id.includes("codeowners")) {
        const status = standards?.codeowners?.status ?? finding.sourceState;
        const labels = {
            missing: ["Missing CODEOWNERS", "attention", "No CODEOWNERS file was found in the confirmed locations."],
            error: ["Ownership errors", "attention", "The ownership file has parser or GitHub-reported errors to review."],
            empty: ["Empty ownership file", "attention", "The file has no owner mappings. Confirm the intended ownership."],
            "needs-confirmation": ["Confirm ownership", "accent", "A CODEOWNERS file exists. Owner access and enforcement still need confirmation."],
        };
        const [label, tone, summary] = labels[status] ?? ["Ownership unknown", "unknown", "The effective CODEOWNERS file could not be confirmed. Do not infer that it is absent."];
        return { title: "Code Ownership", label, tone, summary, next: "Inspect the effective ownership file and related pull requests before proposing a change.", scope: standards?.codeowners?.path ?? ".github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS" };
    }
    if (finding.category === "standards" && finding.id.includes("license")) {
        const license = standards?.license ?? finding.evidence ?? {};
        const mismatch = license.policyMatch === "mismatch";
        const missing = license.presence === "missing";
        return {
            title: "Repository License",
            label: missing ? "License missing" : mismatch ? "Policy mismatch" : license.presence === "present" ? "Review license" : "License unknown",
            tone: missing || mismatch ? "attention" : license.presence === "present" ? "accent" : "unknown",
            summary: missing ? "The configured license file is confirmed absent." : license.presence === "present"
                ? "A license file is present. GitHub recognition and policy expectations are separate checks."
                : "License presence could not be confirmed from the available evidence.",
            next: "Confirm the intended license with an authorized reviewer. File recognition is not legal advice.",
            scope: license.fileName ?? "Configured license file",
        };
    }
    if (finding.category === "dependency-pr") return {
        title: finding.title, label: "Open update", tone: "accent",
        summary: "Review this dependency update, its checks, and existing review feedback. A pull request alone does not prove a security fix.",
        next: "Inspect checks, reviews, and changed files before deciding whether more work is needed.",
        scope: "Selected dependency pull request",
    };
    const alert = finding.evidence?.alert ?? {};
    const open = alert.state === "open";
    return {
        title: finding.title,
        label: open ? "Open alert" : alert.state === "fixed" ? "Source reports fixed" : alert.state === "dismissed" ? "Source reports dismissed" : "State unknown",
        tone: open ? "attention" : "unknown",
        summary: "Reported by GitHub " + (finding.category === "dependency-alert" ? "dependency alerts" : "code scanning") + ". This source state is not a repository-wide assurance.",
        next: "Review the alert location and existing remediation. Confirm fresh source evidence before claiming resolution.",
        scope: alert.manifest || alert.location || "Selected alert location",
    };
}

export function describeDashboardCard(state, category) {
    if (!category.source) {
        const findings = (state.findings ?? []).filter((finding) => finding.category === category.id);
        const attention = findings.filter((finding) => describeFinding(finding, state.standards).tone === "attention");
        const unknown = findings.filter((finding) => describeFinding(finding, state.standards).tone === "unknown");
        return {
            value: !state.scannedAt ? "—" : attention.length ? String(attention.length) : unknown.length || !findings.length ? "Unknown" : String(findings.length),
            label: !state.scannedAt ? "Not checked" : state.stale ? "Stale evidence" : attention.length ? "Needs attention" : unknown.length || !findings.length ? "Needs confirmation" : "Review standards",
            tone: attention.length && !state.stale ? "attention" : "unknown",
            description: !state.scannedAt ? "Ownership and license evidence." : state.stale ? "Previous assessment only. Refresh to confirm."
                : attention.length ? attention.map((finding) => describeFinding(finding, state.standards).label).join(" · ") + (unknown.length ? " · " + unknown.length + " unknown" : "")
                : unknown.length || !findings.length ? "Ownership or license evidence is incomplete." : "Ownership and license checks need review.",
        };
    }
    const collection = state[category.source];
    const source = describeCollection(collection);
    const count = category.id === "dependency-pr" ? collection?.items?.length ?? 0 : (collection?.items ?? []).filter((item) => item.state === "open").length;
    const current = collection?.state === "available" && !collection.stale;
    const partial = current && collection.completeness !== "complete";
    return {
        value: !state.scannedAt ? "—" : current ? partial ? count ? count.toLocaleString() + "+" : "—" : count.toLocaleString()
            : collection?.stale ? count.toLocaleString() : collection?.state === "not-enabled" ? "Off" : "Unknown",
        label: source.label,
        tone: current && count ? category.id === "dependency-pr" ? "accent" : "attention" : source.tone,
        description: collection?.stale ? "Previous count only. Refresh to confirm." : !current ? source.message
            : partial && !count ? "No complete results. The total is unknown."
            : (category.id === "dependency-pr" ? "Open dependency pull requests" : "Open alerts in collected results") + (partial ? " · More may exist" : ""),
    };
}

export function mountInterface(authToken) {
    const $ = (id) => document.getElementById(id);
    const ui = { context: null, state: null, draftKey: null, dirty: false, pending: false, epoch: 0, view: "dashboard", category: "standards" };
    const categories = [
        { id: "standards", title: "Repository Standards", source: null },
        { id: "dependency-pr", title: "Dependency Updates", source: "dependencyPrs" },
        { id: "dependency-alert", title: "Dependency Alerts", source: "dependencyAlerts" },
        { id: "code-alert", title: "Code Security", source: "codeAlerts" },
    ];
    const fields = ["requestedTask", "targetRef", "allowedScope", "constraints", "completionCriteria"];
    const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
    const numberFormat = new Intl.NumberFormat();
    function date(value) {
        const parsed = new Date(value);
        return value && !Number.isNaN(parsed.getTime()) ? dateFormat.format(parsed) : "Not checked";
    }
    function node(tag, text, className) {
        const result = document.createElement(tag);
        if (text !== undefined && text !== null) result.textContent = String(text);
        if (className) result.className = className;
        return result;
    }
    function badge(text, tone = "unknown") { return node("span", text, "badge " + tone); }
    function status(message, error = false) {
        $("status").textContent = message;
        $("status").classList.toggle("error", error);
    }
    function sourceLink(url, text = "Open Source on GitHub") {
        const link = node("a", text);
        const base = ui.state?.repositoryUrl;
        if (typeof url === "string" && typeof base === "string" && url.startsWith(base + "/")) {
            link.href = url;
            link.target = "_blank";
            link.rel = "noreferrer noopener";
        }
        return link;
    }
    function scopeMatches(state) {
        const identity = ui.context?.identity;
        return state && state.mode === ui.context?.mode && ["host", "account", "owner", "repo", "repositoryId"].every((key) => state.identity?.[key] === identity?.[key]);
    }
    async function api(path, body) {
        const response = await fetch(path, {
            method: body === undefined ? "GET" : "POST",
            headers: { Authorization: "Bearer " + authToken, ...(body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": authToken }) },
            body: body === undefined ? undefined : JSON.stringify(body),
            credentials: "same-origin", cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message || "Request failed. Refresh the evidence and retry.");
        return result;
    }
    function setPending(value) {
        ui.pending = value;
        $("findings").setAttribute("aria-busy", String(value));
        for (const id of ["refresh", "mode", "repository", "fixture", "prepareButton", "saveProgress"]) $(id).disabled = value;
        for (const item of document.querySelectorAll(".finding, .dashboard-card")) item.disabled = value;
        $("refresh").textContent = value ? "Refreshing…" : "Refresh";
    }
    function allowNavigation() {
        return !ui.dirty || window.confirm("Discard your unsaved action brief changes?");
    }
    function showView(view, category = ui.category, focus = true) {
        ui.view = view;
        ui.category = category;
        $("dashboard").hidden = view !== "dashboard";
        $("drilldown").hidden = view === "dashboard";
        $("coverageView").hidden = view !== "coverage";
        $("findings").hidden = view !== "category";
        $("actionPanel").hidden = view !== "finding";
        const label = categories.find((item) => item.id === category)?.title ?? "Findings";
        $("backCategory").hidden = view !== "finding";
        $("categorySeparator").hidden = view !== "finding";
        $("backCategory").textContent = label;
        $("currentViewLabel").textContent = view === "finding" ? "/ Finding" : view === "category" ? "/ " + label : view === "coverage" ? "/ Scope" : "";
        $("findingsHeading").textContent = label;
        for (const group of document.querySelectorAll("[data-category]")) group.hidden = group.dataset.category !== category;
        history.replaceState(null, "", view === "dashboard" ? "#dashboard" : "#" + view + "/" + category);
        if (focus) {
            const target = view === "dashboard" ? $("dashboardHeading") : view === "finding" ? $("reviewHeading") : view === "coverage" ? $("coverageView").querySelector("h2") : $("findingsHeading");
            target.focus();
            target.scrollIntoView({ block: "start" });
        }
    }
    function navigate(view, category) {
        if (ui.pending || !allowNavigation()) return;
        if (ui.dirty) { ui.dirty = false; ui.draftKey = null; renderSelected(); }
        showView(view, category);
    }
    function renderDashboard() {
        const state = ui.state;
        $("dashboardSummary").textContent = !state.scannedAt ? "Refresh to collect evidence for this repository."
            : state.stale ? "Showing stale evidence. Refresh before deciding what to do next."
            : "Select an area to review findings. Counts reflect collected evidence, not a health score.";
        $("dashboardCards").replaceChildren();
        for (const category of categories) {
            const { value, label, tone, description } = describeDashboardCard(state, category);
            const card = node("button", null, "dashboard-card");
            card.type = "button";
            card.setAttribute("aria-label", category.title + ": " + value + ". " + label + ". View findings");
            card.append(node("span", category.title, "card-title"), node("strong", value, "card-value"), node("span", description, "card-description"));
            const bottom = node("span", null, "row between card-bottom");
            bottom.append(badge(label, tone), node("span", "View findings →", "arrow hint"));
            card.append(bottom);
            card.addEventListener("click", () => navigate("category", category.id));
            $("dashboardCards").append(card);
        }
    }
    function fact(list, label, value) {
        const row = node("div", null, "fact");
        row.append(node("dt", label), node("dd", value));
        list.append(row);
    }
    function appendFinding(container, finding) {
        const presentation = describeFinding(finding, ui.state.standards);
        const button = node("button", null, "finding");
        button.type = "button";
        button.setAttribute("aria-pressed", String(ui.state.selectedFindingId === finding.id));
        button.dataset.findingId = finding.id;
        const heading = node("span", null, "row");
        heading.append(node("strong", presentation.title), badge(finding.stale ? "Stale evidence" : presentation.label, finding.stale ? "unknown" : presentation.tone));
        button.append(heading, node("p", presentation.summary));
        const record = finding.evidence?.pr ?? finding.evidence?.alert;
        if (record) {
            const parts = [record.number ? "#" + record.number : "", record.author, record.severity, record.manifest || record.location, record.createdAt ? "Created " + date(record.createdAt) : ""].filter(Boolean);
            button.append(node("p", parts.join(" · "), "record-meta"));
        }
        button.addEventListener("click", () => selectFinding(finding.id));
        container.append(button);
    }
    function renderCollection(id, category, collection) {
        const container = $(id);
        container.replaceChildren();
        const description = describeCollection(collection);
        const records = (ui.state.findings ?? []).filter((item) => item.category === category);
        if (records.length) for (const finding of records) appendFinding(container, finding);
        else {
            const complete = collection?.state === "available" && collection?.completeness === "complete" && !collection?.stale;
            container.append(node("p", complete ? "No items returned by this complete collection." : "No complete source evidence is available.", "empty"));
        }
        const coverage = node("div", null, "coverage row");
        coverage.append(badge(description.label, description.tone), node("span", collection?.stale ? "Original scan: " + date(collection.originalScannedAt) : description.message));
        container.append(coverage);
    }
    function renderPolicy() {
        const context = ui.context;
        const target = $("policyMeta");
        target.replaceChildren();
        const facts = node("dl", null, "facts");
        fact(facts, "Policy", context.policyName + " · " + context.policyVersion);
        fact(facts, "Evaluation", context.policyVersion === "unconfigured" ? "No organizational policy configured. Compliance is not evaluated." : "Only the configured checks and expectations are evaluated.");
        if (context.policyReference) fact(facts, "Reference", context.policyReference);
        if (context.reviewerGuidance) fact(facts, "Guidance", context.reviewerGuidance);
        fact(facts, "Collections", (context.enabledChecks ?? []).join(", ") || "Default collection configuration");
        if (context.activeOverride) fact(facts, "Override", context.activeOverride.reason + " · review by " + context.activeOverride.reviewDate);
        for (const exception of context.repositoryExceptions ?? []) fact(facts, "Exception", exception.reason + " · review by " + exception.reviewDate);
        for (const exception of context.licenseExceptions ?? []) fact(facts, "License", exception.condition + ": " + exception.reason + " · review by " + exception.reviewDate);
        target.append(facts);
    }
    function renderSelected() {
        const state = ui.state;
        const finding = state.findings?.find((item) => item.id === state.selectedFindingId);
        $("noSelection").hidden = Boolean(finding);
        $("selection").hidden = !finding;
        if (!finding) { ui.draftKey = null; ui.dirty = false; return; }
        const presentation = describeFinding(finding, state.standards);
        const details = $("findingDetails");
        details.replaceChildren(node("p", finding.category.replaceAll("-", " "), "eyebrow"), node("h3", presentation.title, "selected-title"));
        const badges = node("div", null, "row");
        badges.append(badge(presentation.label, presentation.tone));
        if (finding.stale || state.stale) badges.append(badge("Stale evidence", "unknown"));
        details.append(badges, node("p", presentation.summary, "selected-summary"));
        const facts = node("dl", null, "facts");
        fact(facts, "Source state", finding.sourceState || "Unknown");
        if (finding.category === "standards" && finding.id.includes("license")) {
            const license = state.standards?.license;
            fact(facts, "File presence", license?.presence ?? "Unknown");
            fact(facts, "GitHub match", license?.githubRecognized === null ? "Unknown / unavailable" : license?.githubRecognized ? license.spdxId || "Recognized" : "Not recognized");
            fact(facts, "Policy", license?.policyMatch === "not-evaluated" ? "Not evaluated" : license?.policyMatch ?? "Unknown");
            if (license?.exception) fact(facts, "Exception", license.exception.reason + " · review by " + license.exception.reviewDate);
        }
        const record = finding.evidence?.pr ?? finding.evidence?.alert;
        if (record?.severity) fact(facts, "Severity", record.severity);
        if (record?.createdAt) fact(facts, "Created", date(record.createdAt));
        fact(facts, "Scope", presentation.scope);
        details.append(facts);
        if (record?.url) details.append(sourceLink(record.url));
        const related = state.existingPrLookup;
        if (finding.category === "standards" && related) {
            const heading = node("p", "Existing Remediation", "eyebrow");
            heading.style.marginTop = "18px";
            details.append(heading);
            if (related.state === "not-inspected") details.append(node("p", "Related pull requests have not been inspected yet.", "hint"));
            else if (!related.candidates?.length) details.append(node("p", related.completeness === "complete" ? "No matching changed paths were found in the inspected open pull requests." : "No match in the inspected subset. Other remediation may exist.", "hint"));
            for (const item of related.candidates ?? []) if (item.pr) {
                const paragraph = node("p", null, "note");
                paragraph.append(sourceLink(item.pr.url, "#" + item.pr.number + " · " + item.pr.title));
                details.append(paragraph);
            }
            if (related.completeness !== "complete") details.append(node("p", "Search is bounded or incomplete; confirm existing work before creating more.", "hint"));
        }
        details.append(node("p", "Next step: " + presentation.next, "next-step"));
        $("technicalEvidence").textContent = JSON.stringify({ finding, standards: finding.category === "standards" ? state.standards : undefined, existingPrLookup: finding.category === "standards" ? state.existingPrLookup : undefined }, null, 2);
        const saved = state.taskBriefs?.[finding.id];
        const key = state.mode + ":" + state.identity.repositoryId + ":" + finding.id;
        if (key !== ui.draftKey) $("briefDisclosure").open = false;
        if (key !== ui.draftKey || !ui.dirty) {
            const defaults = {
                requestedTask: "Investigate " + presentation.title + " and report the evidence and next step.",
                targetRef: state.defaultBranchSha || state.defaultBranch || "",
                allowedScope: presentation.scope,
                constraints: "Read-only investigation. Do not edit files, create PRs, comment, merge, or dismiss alerts without separate authorization.",
                completionCriteria: "Confirm the repository and revision, review existing remediation, and report findings with source links and limitations.",
            };
            for (const field of fields) $("briefForm").elements.namedItem(field).value = saved?.[field] ?? defaults[field];
            ui.draftKey = key;
            ui.dirty = false;
        }
        $("handoffSection").hidden = !saved;
        $("handoff").value = saved?.handoff ?? "";
        $("draftStatus").textContent = ui.dirty ? "Unsaved changes" : saved ? "Saved " + date(saved.savedAt) + " · Not dispatched" : "Suggested draft · Review before saving · Not dispatched";
        $("progress").value = finding.workStatus || "needs-attention";
    }
    function render(state, context) {
        ui.state = state;
        ui.context = context;
        const fixture = context.mode === "fixture";
        $("mode").value = context.mode;
        $("mode").querySelector('option[value="live"]').disabled = !context.repositories.length;
        $("modeBadge").textContent = fixture ? "Fixture · Sample Data" : "Live · Read Only";
        $("repository").hidden = fixture;
        $("repositoryLabel").hidden = fixture;
        $("sampleWidget").hidden = !fixture;
        $("repositoryControl").hidden = fixture || context.repositories.length < 2;
        $("repository").replaceChildren(...context.repositories.map((item, index) => {
            const option = node("option", item.owner + "/" + item.repo);
            option.value = String(index);
            option.selected = index === context.repositoryIndex;
            return option;
        }));
        $("fixture").replaceChildren(...context.fixtures.map((item) => {
            const option = node("option", item.label);
            option.value = item.id;
            return option;
        }));
        $("fixture").value = context.fixtureId;
        const identity = context.identity;
        $("repositoryContext").replaceChildren(node("strong", identity.owner + "/" + identity.repo));
        $("headerMeta").textContent = (fixture ? "Read only · " : "Live · Read only · " + identity.host + " · ")
            + (state.stale ? "Stale evidence · " + date(state.originalScannedAt || state.scannedAt) : state.scannedAt ? "Updated " + date(state.scannedAt) : "Not scanned");
        $("scanMeta").replaceChildren(
            node("span", (fixture ? "Fixture timestamp: " : "Last scan: ") + date(state.scannedAt)),
            node("span", "Branch: " + (state.defaultBranch || "Not checked")),
            node("span", "SHA: " + (state.defaultBranchSha ? state.defaultBranchSha.slice(0, 12) : "Not checked")),
        );
        if (state.defaultBranchSha) $("scanMeta").lastChild.title = state.defaultBranchSha;
        if (state.stale) $("scanMeta").append(badge("Stale · " + date(state.originalScannedAt), "attention"));
        const sources = [state.dependencyPrs, state.dependencyAlerts, state.codeAlerts];
        const complete = sources.filter((source) => source?.state === "available" && source.completeness === "complete" && !source.stale).length;
        const unavailable = sources.filter((source) => source && !["available", "not-enabled", "not-checked"].includes(source.state)).length;
        const enabledSourceCount = sources.filter((source) => source?.state !== "not-enabled").length;
        const reviewable = (state.findings ?? []).filter((finding) => {
            if (finding.category === "standards") return true;
            if (finding.category === "dependency-pr") return true;
            return finding.evidence?.alert?.state === "open";
        }).length;
        $("reviewCount").textContent = state.scannedAt ? numberFormat.format(reviewable) : "—";
        $("unavailableCount").textContent = state.scannedAt ? numberFormat.format(unavailable) : "—";
        $("coverageCount").textContent = state.scannedAt ? enabledSourceCount ? complete + " / " + enabledSourceCount : "Off" : "—";
        $("overviewText").textContent = state.stale ? "Earlier evidence is shown as stale. Refresh did not confirm the current repository state." : !state.scannedAt
            ? "No evidence collected yet. Start with Refresh Evidence."
            : (fixture ? "Sample data only. " : "Selected repository only. ") + (unavailable ? "Some sources are unavailable; missing data is not a clean bill of health." : "Review items below; complete collections are not a repository-wide safety verdict.");
        $("standards").replaceChildren();
        const standards = (state.findings ?? []).filter((finding) => finding.category === "standards");
        if (standards.length) for (const finding of standards) appendFinding($("standards"), finding);
        else $("standards").append(node("p", "Refresh to inspect ownership and license evidence.", "empty"));
        for (const file of state.standards?.requiredFiles ?? []) $("standards").append(node("p", "Required file " + file.path + ": " + file.state, "coverage"));
        renderCollection("dependencyPrs", "dependency-pr", state.dependencyPrs);
        renderCollection("dependencyAlerts", "dependency-alert", state.dependencyAlerts);
        renderCollection("codeAlerts", "code-alert", state.codeAlerts);
        const notes = [...new Set(state.limitations ?? [])];
        if (state.error) notes.unshift(state.error);
        $("limitationsHeading").textContent = "Scope & Limitations" + (notes.length ? " · " + numberFormat.format(notes.length) + " notes" : "");
        $("limitations").replaceChildren(...notes.map((note) => node("p", note, "note")));
        renderPolicy();
        renderSelected();
        renderDashboard();
        showView(ui.view, ui.category, false);
        status(state.error ? state.error : "", Boolean(state.error));
    }
    async function refresh() {
        if (ui.pending) return;
        const epoch = ui.epoch;
        setPending(true);
        status("Refreshing authorized repository evidence…");
        try {
            const result = await api("/api/refresh", {});
            if (epoch !== ui.epoch || result.ignored) return;
            if (!scopeMatches(result.state)) return;
            render(result.state, result.context || ui.context);
            if (result.error) status(result.error.message, true);
        } catch (error) { status(error.message, true); }
        finally { setPending(false); }
    }
    async function selectFinding(findingId) {
        if (ui.pending || !allowNavigation()) return;
        setPending(true);
        status("Loading finding evidence and existing remediation…");
        try {
            const state = await api("/api/select", { findingId, expectedRevision: ui.state.revision });
            if (!scopeMatches(state)) return;
            ui.dirty = false;
            ui.draftKey = null;
            render(state, ui.context);
            $("technicalDetails").open = false;
            showView("finding", state.findings.find((finding) => finding.id === findingId)?.category);
        } catch (error) { status(error.message, true); }
        finally { setPending(false); }
    }
    async function switchScope() {
        if (ui.pending) return;
        if (!allowNavigation()) {
            $("mode").value = ui.context.mode;
            $("repository").value = String(ui.context.repositoryIndex);
            $("fixture").value = ui.context.fixtureId;
            return;
        }
        setPending(true);
        ui.epoch += 1;
        status("Loading selected repository…");
        try {
            const result = await api("/api/switch", { mode: $("mode").value, index: Number($("repository").value || 0), fixtureId: $("fixture").value || "standards" });
            if (result.ignored) return;
            ui.dirty = false;
            ui.draftKey = null;
            $("technicalDetails").open = false;
            $("sampleWidget").open = false;
            $("sourceSettings").open = false;
            ui.view = "dashboard";
            render(result.state, result.context);
        } catch (error) {
            $("mode").value = ui.context.mode;
            $("repository").value = String(ui.context.repositoryIndex);
            $("fixture").value = ui.context.fixtureId;
            status(error.message, true);
        } finally { setPending(false); }
    }
    $("refresh").addEventListener("click", refresh);
    $("backDashboard").addEventListener("click", () => navigate("dashboard"));
    $("backCategory").addEventListener("click", () => navigate("category", ui.category));
    $("showCoverage").addEventListener("click", () => navigate("coverage"));
    document.querySelector(".skip").addEventListener("click", (event) => {
        event.preventDefault();
        navigate("dashboard");
    });
    for (const id of ["sampleWidget", "sourceSettings"]) {
        $(id).addEventListener("toggle", () => {
            if ($(id).open) $(id === "sampleWidget" ? "sourceSettings" : "sampleWidget").open = false;
        });
    }
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        for (const id of ["sampleWidget", "sourceSettings"]) if ($(id).open) {
            $(id).open = false;
            $(id).querySelector("summary").focus();
        }
    });
    for (const id of ["mode", "repository", "fixture"]) $(id).addEventListener("change", switchScope);
    $("briefForm").addEventListener("input", () => {
        ui.dirty = true;
        $("draftStatus").textContent = "Unsaved changes";
        $("briefError").hidden = true;
    });
    window.addEventListener("beforeunload", (event) => {
        if (!ui.dirty) return;
        event.preventDefault();
        event.returnValue = "";
    });
    $("briefForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (ui.pending || !ui.state?.selectedFindingId) return;
        setPending(true);
        $("prepareButton").textContent = "Saving…";
        $("briefError").hidden = true;
        const body = Object.fromEntries(new FormData(event.currentTarget).entries());
        body.findingId = ui.state.selectedFindingId;
        body.expectedRevision = ui.state.revision;
        try {
            const result = await api("/api/prepare", body);
            if (!scopeMatches(result.state)) return;
            ui.dirty = false;
            render(result.state, ui.context);
            $("handoff").focus();
            status("Action brief saved. Copy the handoff when ready; nothing was dispatched.");
        } catch (error) {
            $("briefError").textContent = error.message;
            $("briefError").hidden = false;
            status(error.message, true);
        } finally {
            $("prepareButton").textContent = "Save Action Brief";
            setPending(false);
        }
    });
    $("saveProgress").addEventListener("click", async () => {
        if (ui.pending || !ui.state?.selectedFindingId) return;
        setPending(true);
        try {
            const state = await api("/api/progress", { findingId: ui.state.selectedFindingId, status: $("progress").value, expectedRevision: ui.state.revision });
            if (!scopeMatches(state)) return;
            render(state, ui.context);
            status("Work progress saved. The source assessment has not changed.");
        } catch (error) { status(error.message, true); }
        finally { setPending(false); }
    });
    $("copyHandoff").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText($("handoff").value);
            status("Handoff copied. It has not been dispatched.");
        } catch {
            $("handoff").focus();
            $("handoff").select();
            status("Clipboard access is unavailable. The handoff is selected for manual copying.", true);
        }
    });
    api("/api/state").then((result) => render(result.state, result.context)).catch((error) => status(error.message, true));
}
