import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findEffectiveCodeowners, parseCodeowners, checkCodeownersPolicy } from "../.github/extensions/repo-health/src/codeowners.mjs";
import { assessLicense, evaluateHealth, mergeAssessment } from "../.github/extensions/repo-health/src/assessment.mjs";
import { GitHubReader } from "../.github/extensions/repo-health/src/github.mjs";
import { loadFixture } from "../.github/extensions/repo-health/src/fixtures.mjs";
import { HealthService } from "../.github/extensions/repo-health/src/service.mjs";
import { StateStore } from "../.github/extensions/repo-health/src/state.mjs";
import { startCanvasServer } from "../.github/extensions/repo-health/src/server.mjs";
import { emptyCollectionMessage } from "../.github/extensions/repo-health/src/ui.mjs";
import { describeCollection, describeFinding, describeDashboardCard } from "../.github/extensions/repo-health/src/ui-client.mjs";
import { renderPage } from "../.github/extensions/repo-health/src/ui.mjs";
import { Script } from "node:vm";
import { normalizeIdentity, validatePolicy } from "../.github/extensions/repo-health/src/validation.mjs";

const identity = {
    host: "github.com", account: "demo-user", owner: "demo-user", repo: "fixture-repo", repositoryId: "12345",
};

function included(status, body = {}, extraHeaders = {}) {
    const headers = {
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": "10",
        ...extraHeaders,
    };
    return `HTTP/2 ${status} ${status === 200 ? "OK" : "Error"}\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n${JSON.stringify(body)}`;
}

async function temporaryDirectory() {
    return mkdtemp(join(tmpdir(), "repo-health-test-"));
}

test("CODEOWNERS precedence, missing state, and unavailable blocker", () => {
    const files = [
        { path: ".github/CODEOWNERS", state: "missing" },
        { path: "CODEOWNERS", state: "present", text: "* @demo-user" },
        { path: "docs/CODEOWNERS", state: "present", text: "/docs/ @demo-user" },
    ];
    assert.equal(findEffectiveCodeowners(files).path, "CODEOWNERS");
    assert.equal(findEffectiveCodeowners([{ path: ".github/CODEOWNERS", state: "missing" }]).state, "unknown");
    assert.equal(findEffectiveCodeowners([
        { path: ".github/CODEOWNERS", state: "unavailable" },
        { path: "CODEOWNERS", state: "present" },
    ]).blockedBy, ".github/CODEOWNERS");
    assert.equal(findEffectiveCodeowners([
        { path: ".github/CODEOWNERS", state: "missing" },
        { path: "CODEOWNERS", state: "missing" },
        { path: "docs/CODEOWNERS", state: "missing" },
    ]).state, "missing");
});

test("CODEOWNERS parser and configured mapping errors are explicit", () => {
    const result = parseCodeowners("# owners\n/src/** @demo-user\n/docs/ no-owner\n");
    assert.equal(result.mappings.length, 1);
    assert.equal(result.errors.length, 1);
    const policy = checkCodeownersPolicy("/src/** @demo-user\n", [
        { pattern: "/src/**", owners: "@demo-user" },
        { pattern: "/docs/**", owners: "@docs-team" },
    ]);
    assert.deepEqual(policy.policyResults.map((item) => item.status), ["confirmed", "not-matched"]);
    assert.equal(policy.status, "needs-confirmation");
});

test("license presence, recognition, and policy match stay separate", () => {
    const custom = assessLicense(
        [{ path: "LICENSE", state: "present", text: "Custom terms" }],
        { state: "unavailable", status: 404 },
    );
    assert.equal(custom.presence, "present");
    assert.equal(custom.githubRecognized, null);
    assert.equal(custom.spdxId, null);
    assert.equal(custom.policyMatch, "not-evaluated");
    const missing = assessLicense([{ path: "LICENSE", state: "missing" }], { state: "unavailable" }, { license: { required: true } });
    assert.equal(missing.presence, "missing");
    assert.equal(missing.githubRecognized, null);
    assert.equal(missing.policyMatch, "unknown");
    const mismatch = assessLicense(
        [{ path: "LICENSE", state: "present" }],
        { state: "available", spdxId: "MIT" },
        { license: { expectedSpdxIds: ["Apache-2.0"] } },
    );
    assert.equal(mismatch.githubRecognized, true);
    assert.equal(mismatch.policyMatch, "mismatch");
    const excepted = assessLicense(
        [{ path: "LICENSE", state: "present" }],
        { state: "available", spdxId: "MIT" },
        { license: { expectedSpdxIds: ["Apache-2.0"], exceptions: [{
            condition: "spdx-mismatch", spdxIds: ["MIT"], reason: "Approved exception", reviewDate: "2026-12-01",
        }] }, evaluatedAt: "2026-11-03T18:00:00Z" },
    );
    assert.equal(excepted.policyMatch, "excepted");
    assert.equal(excepted.exception.reason, "Approved exception");
    const expired = assessLicense(
        [{ path: "LICENSE", state: "present" }],
        { state: "available", spdxId: "MIT" },
        { license: { expectedSpdxIds: ["Apache-2.0"], exceptions: [{
            condition: "spdx-mismatch", spdxIds: ["MIT"], reason: "Expired exception", reviewDate: "2026-10-01",
        }] }, evaluatedAt: "2026-11-03T18:00:00Z" },
    );
    assert.equal(expired.policyMatch, "mismatch");
});

test("GitHub 403 and 404 remain access/unavailable outcomes", async () => {
    for (const [status, kind] of [[403, "policy-denied"], [404, "unavailable"]]) {
        const reader = new GitHubReader({
            allowedHosts: ["github.com"],
            run: async () => { throw Object.assign(new Error("http error"), { stdout: included(status, { message: "private details" }) }); },
        });
        const result = await reader.content(identity, "LICENSE", "sha", undefined);
        assert.equal(result.state, "unavailable");
        assert.equal(result.reason, kind);
        const collection = await reader.collection(identity, "/repos/demo-user/fixture-repo/dependabot/alerts", undefined);
        assert.equal(collection.state, kind);
        assert.deepEqual(collection.items, []);
    }
});

test("pagination is capped and labels partial results", async () => {
    const reader = new GitHubReader({ allowedHosts: ["github.com"], run: async () => ({ stdout: included(200, []) }) });
    const requested = [];
    reader.request = async (_repo, route) => {
        requested.push(route);
        return {
            body: [{ page: requested.length }],
            headers: { link: '<https://api.github.com/next>; rel="next"' },
        };
    };
    const result = await reader.listAll(identity, "/repos/demo-user/fixture/pulls", undefined, 2);
    assert.equal(result.completeness, "partial");
    assert.equal(result.items.length, 2);
    assert.equal(requested.length, 2);
});

test("empty partial collections never render as zero findings", () => {
    assert.match(emptyCollectionMessage("available", "complete"), /No findings/);
    assert.match(emptyCollectionMessage("available", "partial"), /not a zero\/healthy result/);
    assert.match(emptyCollectionMessage("policy-denied", "unavailable"), /not a zero\/healthy result/);
});

test("UI explains source access, partial evidence, and separate license states", () => {
    assert.equal(describeCollection({ state: "policy-denied", completeness: "unavailable" }).label, "Access restricted");
    assert.match(describeCollection({ state: "policy-denied" }).message, /unknown, not zero/);
    assert.equal(describeCollection({ state: "available", completeness: "partial" }).label, "Partial evidence");
    assert.equal(describeCollection({ state: "available", completeness: "complete", stale: true }).label, "Stale evidence");
    assert.equal(describeCollection({ state: "not-enabled" }).label, "Not enabled");
    const assessment = evaluateHealth(loadFixture("standards"));
    const owners = assessment.findings.find((finding) => finding.id.includes("codeowners"));
    const license = assessment.findings.find((finding) => finding.id.includes("license"));
    assert.equal(describeFinding(owners, assessment.standards).label, "Missing CODEOWNERS");
    assert.equal(describeFinding(license, assessment.standards).label, "Review license");
    assert.match(describeFinding(license, assessment.standards).summary, /separate checks/);
    assert.match(describeFinding(license, assessment.standards).next, /not legal advice/);
    assert.equal(describeFinding({ ...owners, sourceState: "unknown" }, {}).tone, "unknown");
});

test("generated interface embeds its browser helpers and a selection-gated action flow", () => {
    const html = renderPage({ token: "test-token", nonce: "test-nonce" });
    const script = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Script(script));
    for (const helper of ["emptyCollectionMessage", "describeCollection", "describeFinding", "describeDashboardCard", "mountInterface"]) {
        assert.ok(script.includes(`function ${helper}(`), `Missing browser helper: ${helper}`);
    }
    assert.match(html, /id="selection"[^>]*hidden/);
    assert.match(html, /<summary>Technical Evidence<\/summary>/);
    assert.match(html, /Skip to Dashboard/);
    for (const id of ["drilldown", "coverageView", "findings", "actionPanel"]) assert.match(html, new RegExp(`id="${id}"[^>]*hidden`));
    assert.match(html, /<details id="sampleWidget"/);
    assert.match(html, /<details id="briefDisclosure"/);
    assert.match(script, /\$\("sampleWidget"\)\.hidden = !fixture/);
    assert.match(html, /name="targetRef"[^>]*spellcheck="false"/);
    assert.match(script, /beforeunload/);
    assert.doesNotMatch(html, /innerHTML\s*=/);
});

test("dashboard counts distinguish complete, partial, restricted, stale, and disabled sources", () => {
    const category = { id: "dependency-alert", source: "dependencyAlerts" };
    const card = (collection) => describeDashboardCard({ scannedAt: "2026-11-03T00:00:00Z", dependencyAlerts: collection }, category);
    assert.equal(card({ state: "available", completeness: "complete", items: [] }).value, "0");
    const restricted = card({ state: "policy-denied", items: [] });
    assert.equal(restricted.value, "Unknown");
    assert.equal(restricted.label, "Access restricted");
    const partial = card({ state: "available", completeness: "partial", items: [] });
    assert.equal(partial.value, "—");
    assert.match(partial.description, /total is unknown/);
    assert.equal(card({ state: "available", completeness: "partial", items: [{ state: "open" }, { state: "fixed" }] }).value, "1+");
    const stale = card({ state: "policy-denied", stale: true, items: [{ state: "open" }] });
    assert.equal(stale.value, "1");
    assert.equal(stale.label, "Stale evidence");
    assert.match(stale.description, /Previous count only/);
    assert.equal(card({ state: "not-enabled", items: [] }).value, "Off");
    assert.equal(describeDashboardCard({}, category).value, "—");
    const standards = evaluateHealth(loadFixture("standards"));
    const summary = describeDashboardCard(standards, { id: "standards" });
    assert.equal(summary.value, "1");
    assert.equal(summary.label, "Needs attention");
    assert.match(summary.description, /Missing CODEOWNERS/);
});

test("stale prior data keeps its source timestamp; partial current evidence is not globally stale", () => {
    const previous = {
        scannedAt: "2026-11-01T00:00:00.000Z",
        findings: [{ id: "pr:7", category: "dependency-pr", workStatus: "investigating" }],
        dependencyPrs: { items: [{ id: "pr:7" }], completeness: "complete", state: "available" },
        dependencyAlerts: { items: [], completeness: "complete", state: "available" },
        codeAlerts: { items: [], completeness: "complete", state: "available" },
    };
    const partial = mergeAssessment(previous, {
        scannedAt: "2026-11-03T00:00:00.000Z",
        collectionStatuses: { dependencyPrs: "policy-denied", dependencyAlerts: "available", codeAlerts: "available", codeownersErrors: "available" },
        dependencyAlerts: { items: [], completeness: "complete", state: "available" },
        codeAlerts: { items: [], completeness: "complete", state: "available" },
        findings: [],
        limitations: [],
    });
    assert.equal(partial.stale, false);
    assert.equal(partial.dependencyPrs.stale, true);
    assert.equal(partial.dependencyPrs.originalScannedAt, previous.scannedAt);
    assert.equal(partial.findings[0].stale, true);

    const failed = mergeAssessment(previous, {
        collectionStatuses: { dependencyPrs: "transport", dependencyAlerts: "transport", codeAlerts: "transport", codeownersErrors: "transport" },
        limitations: ["Refresh failed."],
    });
    assert.equal(failed.stale, true);
    assert.equal(failed.scannedAt, previous.scannedAt);
    assert.equal(failed.dependencyPrs.state, "transport");
});

test("atomic serialized state updates reject stale revisions", async (t) => {
    const directory = await temporaryDirectory();
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = new StateStore(directory, ["github.com"]);
    await store.update(identity, "live", 0, (current) => ({ ...current, selectedFindingId: "one" }));
    const results = await Promise.allSettled([
        store.update(identity, "live", 1, (current) => ({ ...current, selectedFindingId: "two" })),
        store.update(identity, "live", 1, (current) => ({ ...current, selectedFindingId: "three" })),
    ]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(results.filter((item) => item.status === "rejected" && item.reason.code === "stale_revision").length, 1);
});

test("fixture assessment preserves non-Dependabot remediation candidates and partial limits", () => {
    const assessment = evaluateHealth(loadFixture("existing-pr"), {});
    assert.equal(assessment.dependencyPrs.items.length, 0);
    assert.equal(assessment.openPullRequests[0].dependabot, false);
    assert.equal(assessment.existingPrLookup.state, "not-inspected");
    assert.equal(evaluateHealth(loadFixture("multi-page"), {}).dependencyPrs.completeness, "partial");
    const inaccessible = evaluateHealth(loadFixture("security-access"), {});
    assert.equal(inaccessible.dependencyAlerts.state, "policy-denied");
    assert.equal(inaccessible.codeAlerts.state, "unavailable");
    assert.ok(inaccessible.limitations.some((item) => item.includes("not a zero/healthy signal")));
});

test("repository switch cancels and isolates a late live refresh", async (t) => {
    const directory = await temporaryDirectory();
    t.after(() => rm(directory, { recursive: true, force: true }));
    let releaseCollection;
    let refreshSignal;
    const reader = {
        repository: async (value) => ({
            identity: { ...value, repositoryId: value.repo === "first" ? "1001" : "1002" },
            defaultBranch: "main",
            defaultBranchSha: "sha",
        }),
        collect: async (_identity, _policy, { signal }) => {
            refreshSignal = signal;
            return new Promise((resolve) => { releaseCollection = resolve; });
        },
    };
    const service = new HealthService({ workspacePath: directory, storeDirectory: join(directory, "state"), reader });
    await service.openInstance("switch-test", {
        mode: "live",
        repositories: [
            { host: "github.com", account: "demo-user", owner: "demo-user", repo: "first" },
            { host: "github.com", account: "demo-user", owner: "demo-user", repo: "second" },
        ],
    });
    const refresh = service.refreshHealth("switch-test");
    await new Promise((resolve) => setImmediate(resolve));
    const switched = await service.switchRepository("switch-test", { mode: "live", index: 1, fixtureId: "standards" });
    assert.equal(switched.context.identity.repositoryId, "1002");
    assert.equal(refreshSignal.aborted, true);
    releaseCollection({
        ...loadFixture("standards"),
        repository: {
            ...loadFixture("standards").repository,
            identity: { host: "github.com", account: "demo-user", owner: "demo-user", repo: "first", repositoryId: "1001" },
        },
    });
    assert.equal((await refresh).ignored, true);
    assert.equal((await service.getHealth("switch-test")).state.scannedAt, null);
    await service.closeInstance("switch-test");
});

test("actions, UI server, state persistence, and fixture/live isolation share the same service", async (t) => {
    const directory = await temporaryDirectory();
    t.after(() => rm(directory, { recursive: true, force: true }));
    const reader = new GitHubReader({ allowedHosts: ["github.com"], run: async () => { throw new Error("Fixture mode attempted a live call."); } });
    const service = new HealthService({ workspacePath: directory, storeDirectory: join(directory, "state"), reader });
    const input = { mode: "fixture", fixtureId: "existing-pr" };
    const opened = await startCanvasServer({ service, instanceId: "test-instance", input });
    t.after(() => opened.close());
    const origin = opened.url.slice(0, -1);
    const page = await fetch(opened.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
    const html = await page.text();
    const token = html.match(/const authToken = "([^"]+)";/)?.[1];
    assert.ok(token);
    assert.equal((await fetch(new URL("/api/state", opened.url))).status, 403);
    const call = (path, body) => fetch(new URL(path, opened.url), {
        method: body === undefined ? "GET" : "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { Origin: origin, "X-CSRF-Token": token, "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    assert.equal((await call("/api/refresh", {})).status, 200);
    const wrongOrigin = await fetch(new URL("/api/refresh", opened.url), {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            Origin: "https://not-local.invalid",
            "X-CSRF-Token": token,
            "Content-Type": "application/json",
        },
        body: "{}",
    });
    assert.equal(wrongOrigin.status, 403);
    const initial = await (await call("/api/state")).json();
    assert.equal(initial.context.mode, "fixture");
    const standardFinding = initial.state.findings.find((item) => item.category === "standards");
    assert.ok(standardFinding);
    const selectedResponse = await call("/api/select", { findingId: standardFinding.id, expectedRevision: initial.state.revision });
    assert.equal(selectedResponse.status, 200);
    const selected = await selectedResponse.json();
    assert.equal(selected.selectedFindingId, standardFinding.id);
    assert.equal(selected.existingPrLookup.state, "inspected");
    assert.equal(selected.existingPrLookup.candidates[0].pr.number, 41);
    assert.deepEqual(selected.existingPrLookup.candidates[0].matchedPaths, [".github/CODEOWNERS"]);

    const preparedResponse = await call("/api/prepare", {
        requestedTask: "Review existing owner mapping",
        targetRef: "main",
        allowedScope: ".github/CODEOWNERS",
        constraints: "Do not change policy without approval",
        completionCriteria: "Report evidence and limits",
        findingId: standardFinding.id,
        expectedRevision: selected.revision,
    });
    assert.equal(preparedResponse.status, 200);
    const prepared = await preparedResponse.json();
    assert.match(prepared.handoff, /FIXTURE MODE/);
    assert.equal(prepared.state.taskBriefs[standardFinding.id].completionCriteria, "Report evidence and limits");
    const task = await service.getSelectedTask("test-instance");
    assert.equal(task.brief.findingId, standardFinding.id);

    const reloaded = new HealthService({ workspacePath: directory, storeDirectory: join(directory, "state") });
    await reloaded.openInstance("reloaded", input);
    assert.equal((await reloaded.getHealth("reloaded")).state.selectedFindingId, standardFinding.id);
    const sameIdentityStore = new StateStore(join(directory, "state"), ["github.com"]);
    const sameIdentity = loadFixture("existing-pr").repository.identity;
    const fixtureState = await sameIdentityStore.read(sameIdentity, "fixture");
    const liveState = await sameIdentityStore.read(sameIdentity, "live");
    assert.equal(fixtureState.selectedFindingId, standardFinding.id);
    assert.equal(liveState.selectedFindingId, null);
    const otherRepository = await sameIdentityStore.read(loadFixture("standards").repository.identity, "fixture");
    assert.equal(otherRepository.selectedFindingId, null);
    await reloaded.closeInstance("reloaded");
});

test("invalid inputs and progress cannot claim verified resolution", async (t) => {
    const directory = await temporaryDirectory();
    t.after(() => rm(directory, { recursive: true, force: true }));
    const service = new HealthService({ workspacePath: directory, storeDirectory: join(directory, "state") });
    await service.openInstance("invalid-test", { mode: "fixture", fixtureId: "standards" });
    await assert.rejects(() => service.selectFinding("invalid-test", { findingId: "other-repo:finding", expectedRevision: 0 }), /does not exist/);
    await assert.rejects(() => service.prepareAction("invalid-test", { requestedTask: "incomplete" }), /Select an existing finding/);
    await assert.rejects(() => service.updateTaskProgress("invalid-test", { status: "verified-resolved" }), /verified resolution/);
    await service.closeInstance("invalid-test");
});

test("GitHub discovery invokes only fixed read-only gh api arguments", async () => {
    let captured;
    const reader = new GitHubReader({
        allowedHosts: ["github.com"],
        run: async (command, args) => {
            captured = { command, args };
            return { stdout: included(200, { id: 12345 }) };
        },
    });
    await reader.request(identity, "/repos/demo-user/fixture-repo");
    assert.equal(captured.command, "gh");
    assert.equal(captured.args[0], "api");
    assert.equal(captured.args.includes("-X"), false);
    assert.equal(captured.args.some((arg) => /(?:POST|PATCH|PUT|DELETE)/i.test(arg)), false);
    assert.ok(captured.args.includes("X-GitHub-Api-Version: 2022-11-28"));
    await assert.rejects(() => reader.request(identity, "https://example.invalid"), /fixed endpoint/);
    assert.throws(() => normalizeIdentity({ ...identity, host: "127.0.0.1" }, ["127.0.0.1"]), /local or numeric address/);
    assert.equal(normalizeIdentity({ ...identity, account: "demo_user" }, ["github.com"]).account, "demo_user");
    const normalizedWithoutRepositoryId = normalizeIdentity({ ...identity, repositoryId: undefined }, ["github.com"]);
    assert.equal(normalizedWithoutRepositoryId.repositoryId, null);
    assert.equal(normalizeIdentity(normalizedWithoutRepositoryId, ["github.com"]).repositoryId, null);
    const unauthenticated = new GitHubReader({
        allowedHosts: ["github.com"],
        run: async () => {
            const error = new Error("gh failed");
            error.stderr = "not logged in to github.com";
            throw error;
        },
    });
    await assert.rejects(() => unauthenticated.request(identity, "/user"), { kind: "authentication" });
});

test("policy validation rejects root traversal and malformed exceptions", () => {
    assert.throws(() => validatePolicy({ schemaVersion: 1, requiredStandards: ["../secret"] }), /outside the repository root/);
    assert.throws(() => validatePolicy({
        schemaVersion: 1,
        repositoryExceptions: [{ reason: "temporary", reviewDate: "2026-99-99" }],
    }), /valid YYYY-MM-DD/);
    assert.throws(() => validatePolicy({
        schemaVersion: 1,
        repositoryOverrides: [{
            host: "github.com", owner: "demo-user", repo: "fixture-repo", reason: "temporary",
            policy: { schemaVersion: 1 },
        }],
    }), /reviewDate/);
    assert.equal(validatePolicy({ schemaVersion: 1 }).schemaVersion, 1);
    const service = new HealthService({
        workspacePath: ".",
        reader: new GitHubReader({ allowedHosts: ["github.com"] }),
    });
    const base = validatePolicy({
        schemaVersion: 1,
        repositoryOverrides: [{
            host: "github.com", owner: "demo-user", repo: "fixture-repo", reason: "approved",
            reviewDate: "2026-12-01",
            policy: { schemaVersion: 1, version: "override" },
        }],
    });
    assert.equal(service.policyFor(identity, base).version, "override");
    assert.throws(() => validatePolicy({ schemaVersion: 1, enabledChecks: ["secret-scanning"] }), /unsupported check/);
});

test("baseline actions contain no dependency aging filter", async () => {
    const entry = await readFile(new URL("../.github/extensions/repo-health/extension.mjs", import.meta.url), "utf8");
    const ui = await readFile(new URL("../.github/extensions/repo-health/src/ui.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(entry + ui, /set_dependency_pr_filter|thresholdDays|waitingOverDays/i);
    const fixture = loadFixture("multi-page");
    assert.deepEqual(fixture.dependencyPrs.items.map((item) => item.created_at), [
        "2026-10-13T18:00:01Z", "2026-10-13T18:00:00Z", "2026-10-13T17:59:59Z",
    ]);
});
