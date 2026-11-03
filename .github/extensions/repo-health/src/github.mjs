import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    API_VERSION, MAX_BODY_BYTES, MAX_CONCURRENCY, MAX_PAGES, boundedText, isWithinRoot,
    normalizeIdentity, safeRepoUrl,
} from "./validation.mjs";

const execFileAsync = promisify(execFile);
const APPROVED_HOSTS = (process.env.REPO_HEALTH_APPROVED_HOSTS || "github.com")
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
const DEFAULT_CHECKS = [
    "repository-standards", "codeowners-errors", "github-license-recognition",
    "dependabot-prs", "dependency-alerts", "code-scanning-alerts",
];

function responseError(status, headers, body) {
    const retryAfter = headers["retry-after"] ?? null;
    const remaining = headers["x-ratelimit-remaining"];
    let kind = "http";
    if (status === 401) kind = "authentication";
    else if (status === 403 && (retryAfter || remaining === "0")) kind = "rate-limit";
    else if (status === 403) kind = "policy-denied";
    else if (status === 404) kind = "unavailable";
    else if (status === 429) kind = "rate-limit";
    else if (status >= 500) kind = "unavailable";
    const error = new Error(`GitHub request failed (${kind}, HTTP ${status}).`);
    error.kind = kind;
    error.status = status;
    error.retryAfter = retryAfter;
    error.sourceMessage = boundedText(body, 200);
    return error;
}

function parseIncludedResponse(text) {
    const separator = /\r?\n\r?\n/;
    const match = separator.exec(text);
    if (!match) throw new Error("GitHub CLI returned an unreadable response.");
    const headerText = text.slice(0, match.index);
    const bodyText = text.slice(match.index + match[0].length);
    const statusLine = headerText.split(/\r?\n/).find((line) => /^HTTP\/\S+\s+\d{3}/i.test(line));
    const status = Number(statusLine?.match(/\s(\d{3})\s/)?.[1]);
    if (!status) throw new Error("GitHub CLI returned an invalid HTTP status.");
    const headers = {};
    for (const line of headerText.split(/\r?\n/).slice(1)) {
        const index = line.indexOf(":");
        if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
    let body;
    try {
        body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
        throw new Error("GitHub returned invalid JSON.");
    }
    return { status, headers, body, rawBody: bodyText };
}

function hasNext(linkHeader) {
    return Boolean(linkHeader && /;\s*rel="next"/i.test(linkHeader));
}

function parseContent(content) {
    if (!content || typeof content.content !== "string") throw new Error("GitHub returned an invalid file payload.");
    return Buffer.from(content.content, content.encoding === "base64" ? "base64" : "utf8").toString("utf8");
}

async function mapBounded(items, limit, callback) {
    const results = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await callback(items[index], index);
        }
    }));
    return results;
}

export class GitHubReader {
    constructor({ run = execFileAsync, allowedHosts = APPROVED_HOSTS } = {}) {
        this.run = run;
        this.allowedHosts = allowedHosts;
    }

    identity(value) {
        return normalizeIdentity(value, this.allowedHosts);
    }

    async request(identityInput, route, { signal } = {}) {
        const identity = this.identity(identityInput);
        if (!route.startsWith("/") || route.startsWith("//") || /[\r\n]/.test(route)) {
            throw new Error("GitHub route is not an allowed fixed endpoint.");
        }
        const args = [
            "api", "--include", "--hostname", identity.host,
            "-H", "Accept: application/vnd.github+json",
            "-H", `X-GitHub-Api-Version: ${API_VERSION}`,
            route.slice(1),
        ];
        let result;
        try {
            result = await this.run("gh", args, {
                encoding: "utf8",
                maxBuffer: MAX_BODY_BYTES + 16 * 1024,
                timeout: 20_000,
                windowsHide: true,
                signal,
            });
        } catch (error) {
            if (signal?.aborted || error.name === "AbortError") throw error;
            if (typeof error.stdout === "string" && error.stdout.includes("HTTP/")) {
                try {
                    const response = parseIncludedResponse(error.stdout);
                    throw responseError(response.status, response.headers, response.rawBody);
                } catch (responseFailure) {
                    if (responseFailure.status) throw responseFailure;
                }
            }
            const cliMessage = String(error.stderr ?? "").toLowerCase();
            if (/not logged in|authentication required|not authenticated|no authentication/.test(cliMessage)) {
                const authentication = new Error("GitHub CLI has no authenticated account for the approved host.");
                authentication.kind = "authentication";
                throw authentication;
            }
            const transport = new Error("GitHub CLI could not complete the request. Check authentication and network connectivity.");
            transport.kind = "transport";
            transport.cause = error;
            throw transport;
        }
        const raw = typeof result === "string" ? result : result.stdout;
        if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES + 16 * 1024) {
            throw new Error("GitHub response exceeded the configured body limit.");
        }
        const response = parseIncludedResponse(raw);
        if (Buffer.byteLength(response.rawBody, "utf8") > MAX_BODY_BYTES) {
            throw new Error("GitHub response body exceeded the configured body limit.");
        }
        if (response.status < 200 || response.status >= 300) {
            throw responseError(response.status, response.headers, response.rawBody);
        }
        return response;
    }

    async verifyAccount(identityInput, signal) {
        const identity = this.identity(identityInput);
        const { body } = await this.request(identity, "/user", { signal });
        if (!body || typeof body.login !== "string") throw new Error("GitHub did not return an authenticated account.");
        if (body.login.toLowerCase() !== identity.account.toLowerCase()) {
            const error = new Error(`Authenticated account does not match the explicitly approved account (${identity.account}).`);
            error.kind = "identity-mismatch";
            throw error;
        }
        return body.login;
    }

    async repository(identityInput, signal) {
        const identity = this.identity(identityInput);
        await this.verifyAccount(identity, signal);
        const { body: repo } = await this.request(identity, `/repos/${identity.owner}/${identity.repo}`, { signal });
        if (!repo || !Number.isSafeInteger(repo.id)) throw new Error("Repository metadata did not include a safe numeric ID.");
        if (repo.owner?.login?.toLowerCase() !== identity.owner.toLowerCase() ||
            repo.name?.toLowerCase() !== identity.repo.toLowerCase()) {
            throw new Error("GitHub repository identity did not match the selected repository.");
        }
        const resolvedIdentity = { ...identity, repositoryId: String(repo.id) };
        const branch = repo.default_branch;
        if (typeof branch !== "string" || !branch) throw new Error("GitHub repository has no readable default branch.");
        const commit = await this.request(resolvedIdentity, `/repos/${identity.owner}/${identity.repo}/commits/${encodeURIComponent(branch)}`, { signal });
        return {
            identity: resolvedIdentity,
            url: safeRepoUrl(resolvedIdentity, "", this.allowedHosts),
            defaultBranch: branch,
            defaultBranchSha: commit.body?.sha ?? null,
            archived: Boolean(repo.archived),
        };
    }

    async content(identity, path, sha, signal) {
        if (!isWithinRoot(path)) throw new Error("Repository path is invalid.");
        const route = `/repos/${identity.owner}/${identity.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`;
        try {
            const { body } = await this.request(identity, route, { signal });
            return { path, state: "present", text: parseContent(body), htmlUrl: body.html_url ?? null };
        } catch (error) {
            if (error.status === 404 || error.status === 403) {
                return { path, state: "unavailable", reason: error.kind, status: error.status };
            }
            throw error;
        }
    }

    async listAll(identity, route, signal, maxPages = MAX_PAGES) {
        const items = [];
        let next = false;
        for (let page = 1; page <= maxPages; page += 1) {
            const separator = route.includes("?") ? "&" : "?";
            const response = await this.request(identity, `${route}${separator}per_page=100&page=${page}`, { signal });
            if (!Array.isArray(response.body)) throw new Error("GitHub collection endpoint returned a non-array response.");
            items.push(...response.body);
            next = hasNext(response.headers.link);
            if (!next) return { items, completeness: "complete", pages: page };
        }
        return {
            items,
            completeness: next ? "partial" : "complete",
            pages: maxPages,
            truncated: next,
        };
    }

    async collection(identity, route, signal) {
        try {
            return { ...(await this.listAll(identity, route, signal)), state: "available" };
        } catch (error) {
            return {
                items: [],
                completeness: "unavailable",
                state: error.kind ?? (error.status === 403 ? "policy-denied" : error.status === 404 ? "unavailable" : "error"),
                error: { kind: error.kind ?? "error", status: error.status ?? null, retryAfter: error.retryAfter ?? null },
            };
        }
    }

    async pullRequestFiles(identity, number, signal) {
        const result = await this.listAll(
            identity,
            `/repos/${identity.owner}/${identity.repo}/pulls/${number}/files`,
            signal,
            1,
        );
        return {
            files: result.items.map((file) => boundedText(file.filename, 200)).filter(Boolean),
            completeness: result.completeness,
        };
    }

    async inspectPullRequest(identity, number, signal) {
        if (!Number.isSafeInteger(number) || number < 1) throw new Error("Pull request number is invalid.");
        const base = `/repos/${identity.owner}/${identity.repo}/pulls/${number}`;
        const [pull, reviews, files] = await Promise.all([
            this.request(identity, base, { signal }),
            this.collection(identity, `${base}/reviews`, signal),
            this.pullRequestFiles(identity, number, signal),
        ]);
        const sha = pull.body?.head?.sha;
        const [checks, status] = sha ? await Promise.all([
            this.collection(identity, `/repos/${identity.owner}/${identity.repo}/commits/${encodeURIComponent(sha)}/check-runs`, signal),
            this.request(identity, `/repos/${identity.owner}/${identity.repo}/commits/${encodeURIComponent(sha)}/status`, { signal })
                .then(({ body }) => ({
                    state: boundedText(body.state, 40),
                    totalCount: Number.isSafeInteger(body.total_count) ? body.total_count : null,
                    contexts: Array.isArray(body.statuses) ? body.statuses.slice(0, 100).map((item) => ({
                        context: boundedText(item.context, 150),
                        state: boundedText(item.state, 50),
                        createdAt: typeof item.created_at === "string" ? item.created_at : null,
                    })) : [],
                }))
                .catch((error) => ({ state: error.kind ?? "error", totalCount: null, contexts: [] })),
        ]) : [
            { items: [], completeness: "unavailable", state: "unavailable" },
            { state: "unavailable", totalCount: null, contexts: [] },
        ];
        return {
            pullRequest: {
                number,
                title: boundedText(pull.body?.title, 500),
                draft: Boolean(pull.body?.draft),
                headSha: boundedText(sha, 100),
                baseRef: boundedText(pull.body?.base?.ref, 200),
            },
            files,
            reviews: {
                state: reviews.state,
                completeness: reviews.completeness,
                items: reviews.items.slice(0, 100).map((review) => ({
                    state: boundedText(review.state, 40),
                    submittedAt: typeof review.submitted_at === "string" ? review.submitted_at : null,
                    author: boundedText(review.user?.login, 100),
                })),
            },
            checks: {
                state: checks.state,
                completeness: checks.completeness,
                items: checks.items.slice(0, 100).map((check) => ({
                    name: boundedText(check.name, 150),
                    status: boundedText(check.status, 50),
                    conclusion: boundedText(check.conclusion, 50),
                })),
            },
            combinedStatus: status,
        };
    }

    async collect(identityInput, policy, { signal, onProgress = () => {} } = {}) {
        const repo = await this.repository(identityInput, signal);
        const enabled = new Set(policy.enabledChecks ?? DEFAULT_CHECKS);
        const isEnabled = (name) => enabled.has(name);
        const licenseNames = policy.license?.approvedFileNames ?? ["LICENSE"];
        const standardPaths = isEnabled("repository-standards") ? [...new Set([
            ".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS",
            ...licenseNames, ...(policy.requiredStandards ?? []),
        ])].filter(isWithinRoot) : [];
        const fileResults = await mapBounded(standardPaths, MAX_CONCURRENCY, async (path) => {
            try {
                const result = await this.content(repo.identity, path, repo.defaultBranchSha, signal);
                onProgress({ source: "standards", path, state: result.state });
                return result;
            } catch (error) {
                return { path, state: "error", error: { kind: error.kind ?? "error" } };
            }
        });
        const codeownersErrors = isEnabled("codeowners-errors")
            ? await this.collection(
                repo.identity,
                `/repos/${repo.identity.owner}/${repo.identity.repo}/codeowners/errors?ref=${encodeURIComponent(repo.defaultBranchSha)}`,
                signal,
            )
            : { items: [], state: "not-enabled", completeness: "not-checked" };
        const routes = {
            dependencyPrs: `/repos/${repo.identity.owner}/${repo.identity.repo}/pulls?state=open&sort=created&direction=desc`,
            dependencyAlerts: `/repos/${repo.identity.owner}/${repo.identity.repo}/dependabot/alerts?state=all`,
            codeAlerts: `/repos/${repo.identity.owner}/${repo.identity.repo}/code-scanning/alerts?state=all`,
            licenseRecognition: `/repos/${repo.identity.owner}/${repo.identity.repo}/license`,
        };
        const entries = Object.entries(routes);
        const collected = {};
        let index = 0;
        const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, entries.length) }, async () => {
            while (index < entries.length) {
                if (signal?.aborted) throw signal.reason ?? new Error("Refresh cancelled.");
                const current = entries[index++];
                const checkName = {
                    dependencyPrs: "dependabot-prs",
                    dependencyAlerts: "dependency-alerts",
                    codeAlerts: "code-scanning-alerts",
                }[current[0]];
                if (current[0] !== "licenseRecognition" && !isEnabled(checkName)) {
                    collected[current[0]] = { items: [], state: "not-enabled", completeness: "not-checked" };
                    continue;
                }
                if (current[0] === "licenseRecognition") {
                    if (!isEnabled("github-license-recognition")) {
                        collected.licenseRecognition = { state: "not-enabled", spdxId: null };
                        continue;
                    }
                    try {
                        const { body } = await this.request(repo.identity, current[1], { signal });
                        collected.licenseRecognition = { state: "available", license: body.license ?? null, spdxId: body.license?.spdx_id ?? null };
                    } catch (error) {
                        collected.licenseRecognition = {
                            state: error.kind ?? "error",
                            status: error.status ?? null,
                        };
                    }
                } else {
                    collected[current[0]] = await this.collection(repo.identity, current[1], signal);
                    onProgress({ source: current[0], state: collected[current[0]].state });
                }
            }
        });
        await Promise.all(workers);
        if (signal?.aborted) throw signal.reason ?? new Error("Refresh cancelled.");
        return {
            repository: repo,
            files: fileResults,
            codeownersErrors,
            ...collected,
            scannedAt: new Date().toISOString(),
        };
    }
}

export { APPROVED_HOSTS };
