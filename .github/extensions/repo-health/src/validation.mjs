export const API_VERSION = "2022-11-28";
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_PAGES = 5;
export const MAX_FINDINGS = 500;
export const MAX_CONCURRENCY = 3;

const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*(?::\d{1,5})?$/i;
const SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/;
const ACCOUNT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,98}[A-Za-z0-9])?$/;

export function normalizeIdentity(value, allowedHosts = []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Repository identity is required.");
    }
    const host = String(value.host ?? "").trim().toLowerCase();
    const account = String(value.account ?? "").trim();
    const owner = String(value.owner ?? "").trim();
    const repo = String(value.repo ?? "").trim();
    if (!HOST_PATTERN.test(host) || host.includes("..") || host.startsWith(".") || host.endsWith(".")) {
        throw new Error("Host must be a hostname with an optional port.");
    }
    if (host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(host)) {
        throw new Error("Host must be an explicitly approved GitHub hostname, not a local or numeric address.");
    }
    const portText = host.match(/:(\d+)$/)?.[1];
    if (portText && (Number(portText) < 1 || Number(portText) > 65535)) {
        throw new Error("Host port is invalid.");
    }
    if (!ACCOUNT_PATTERN.test(account) || !SLUG_PATTERN.test(owner) || !SLUG_PATTERN.test(repo)) {
        throw new Error("Account, owner, and repository must be valid GitHub slugs.");
    }
    if (allowedHosts.length && !allowedHosts.map((entry) => String(entry).toLowerCase()).includes(host)) {
        throw new Error("Host is not in the explicitly approved host list.");
    }
    const repositoryId = value.repositoryId === undefined || value.repositoryId === null
        ? null
        : String(value.repositoryId);
    if (repositoryId !== null && !/^\d{1,20}$/.test(repositoryId)) {
        throw new Error("Repository ID must be numeric.");
    }
    return { host, account, owner, repo, repositoryId };
}

export function scopeKey(identity, mode, allowedHosts = []) {
    const { host, owner, repo, repositoryId } = normalizeIdentity(identity, allowedHosts);
    if (mode !== "live" && mode !== "fixture") throw new Error("Mode must be live or fixture.");
    const account = normalizeIdentity(identity, allowedHosts).account;
    return `${mode}:${host}/${account}/${repositoryId ?? `${owner}/${repo}`}`.toLowerCase();
}

export function safeRepoUrl(identity, route = "", allowedHosts = []) {
    const { host, owner, repo } = normalizeIdentity(identity, allowedHosts);
    if (route && (!route.startsWith("/") || route.startsWith("//") || /[\r\n]/.test(route))) {
        throw new Error("Repository route is invalid.");
    }
    return `https://${host}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${route}`;
}

export function isWithinRoot(path) {
    return typeof path === "string" && path.length > 0 &&
        !path.startsWith("/") && !path.includes("\\") &&
        !path.split("/").some((part) => part === "" || part === "." || part === "..") &&
        !/[\u0000-\u001f\u007f]/.test(path);
}

export function validatePolicy(policy) {
    if (!policy || typeof policy !== "object" || Array.isArray(policy) || policy.schemaVersion !== 1) {
        throw new Error("Policy schemaVersion must be 1.");
    }
    const allowed = new Set([
        "schemaVersion", "name", "version", "reference", "requiredStandards",
        "license", "confirmedCodeowners", "reviewerGuidance", "dependabotAuthors",
        "enabledChecks", "repositoryExceptions", "repositoryOverrides",
    ]);
    for (const key of Object.keys(policy)) {
        if (!allowed.has(key)) throw new Error(`Unknown policy field: ${key}`);
    }
    for (const field of ["name", "version", "reference"]) {
        if (policy[field] !== undefined && (typeof policy[field] !== "string" || policy[field].length > 256)) {
            throw new Error(`Policy ${field} must be a string of at most 256 characters.`);
        }
    }
    const strings = (value, label, max = 100) => {
        if (value === undefined) return;
        if (!Array.isArray(value) || value.length > max || value.some((entry) => typeof entry !== "string" || entry.length > 256)) {
            throw new Error(`${label} must be a bounded array of strings.`);
        }
    };
    strings(policy.requiredStandards, "requiredStandards");
    if (policy.requiredStandards?.some((path) => !isWithinRoot(path))) {
        throw new Error("requiredStandards contains a path outside the repository root.");
    }
    strings(policy.dependabotAuthors, "dependabotAuthors");
    strings(policy.enabledChecks, "enabledChecks");
    const supportedChecks = new Set([
        "repository-standards", "codeowners-errors", "github-license-recognition",
        "dependabot-prs", "dependency-alerts", "code-scanning-alerts",
    ]);
    if (policy.enabledChecks?.some((check) => !supportedChecks.has(check))) {
        throw new Error("enabledChecks contains an unsupported check name.");
    }
    if (policy.license !== undefined && (!policy.license || typeof policy.license !== "object" || Array.isArray(policy.license))) {
        throw new Error("license must be an object.");
    }
    if (policy.license) {
        for (const key of Object.keys(policy.license)) {
            if (!["required", "expectedSpdxIds", "approvedFileNames", "templateReference", "exceptions"].includes(key)) {
                throw new Error(`Unknown license policy field: ${key}`);
            }
        }
        if (policy.license.required !== undefined && typeof policy.license.required !== "boolean") {
            throw new Error("license.required must be a boolean.");
        }
        strings(policy.license.expectedSpdxIds, "license.expectedSpdxIds");
        strings(policy.license.approvedFileNames, "license.approvedFileNames", 20);
        if (policy.license.approvedFileNames?.some((path) => !isWithinRoot(path) || path.includes("/"))) {
            throw new Error("license.approvedFileNames must contain root-level filenames.");
        }
        if (policy.license.templateReference !== undefined &&
            (typeof policy.license.templateReference !== "string" || policy.license.templateReference.length > 500)) {
            throw new Error("license.templateReference must be a string of at most 500 characters.");
        }
        validateExceptions(policy.license.exceptions, "license.exceptions", "license");
    }
    if (policy.confirmedCodeowners !== undefined) {
        if (!Array.isArray(policy.confirmedCodeowners) || policy.confirmedCodeowners.length > 100) {
            throw new Error("confirmedCodeowners must be a bounded array.");
        }
        for (const mapping of policy.confirmedCodeowners) {
            if (!mapping || typeof mapping.pattern !== "string" || typeof mapping.owners !== "string") {
                throw new Error("Each confirmedCodeowners entry requires pattern and owners strings.");
            }
        }
    }
    if (policy.reviewerGuidance !== undefined && (typeof policy.reviewerGuidance !== "string" || policy.reviewerGuidance.length > 2000)) {
        throw new Error("reviewerGuidance must be a string of at most 2000 characters.");
    }
    if (policy.repositoryExceptions !== undefined) {
        validateExceptions(policy.repositoryExceptions, "repositoryExceptions", "repository");
    }
    if (policy.repositoryOverrides !== undefined) {
        if (!Array.isArray(policy.repositoryOverrides) || policy.repositoryOverrides.length > 100) {
            throw new Error("repositoryOverrides must be a bounded array.");
        }
        for (const override of policy.repositoryOverrides) {
            if (!override || typeof override !== "object" || Array.isArray(override) ||
                typeof override.host !== "string" || typeof override.owner !== "string" ||
                typeof override.repo !== "string" || !override.policy || typeof override.policy !== "object" ||
                typeof override.reason !== "string" || !override.reason.trim() ||
                typeof override.reviewDate !== "string") {
                throw new Error("Each repository override requires host, owner, repo, reason, reviewDate, and policy.");
            }
            validateExceptions([{ reason: override.reason, reviewDate: override.reviewDate }], "repositoryOverrides", "repository");
            for (const key of Object.keys(override)) {
                if (!["host", "owner", "repo", "reason", "reviewDate", "policy"].includes(key)) {
                    throw new Error(`Unknown repository override field: ${key}`);
                }
            }
            normalizeIdentity({ host: override.host, account: override.owner, owner: override.owner, repo: override.repo });
            if (Object.hasOwn(override.policy, "repositoryOverrides")) {
                throw new Error("Nested repositoryOverrides are not allowed.");
            }
            validatePolicy(override.policy);
        }
    }
    return policy;
}

function validateExceptions(exceptions, label, kind) {
    if (exceptions === undefined) return;
    if (!Array.isArray(exceptions) || exceptions.length > 100) {
        throw new Error(`${label} must be a bounded array.`);
    }
    for (const exception of exceptions) {
        const date = exception?.reviewDate;
        const validDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
            !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
            new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
        if (!exception || typeof exception !== "object" || typeof exception.reason !== "string" ||
            !exception.reason.trim() || exception.reason.length > 1000 || !validDate) {
            throw new Error(`Each ${label} entry requires a reason and valid YYYY-MM-DD reviewDate.`);
        }
        const allowed = kind === "license" ? ["condition", "spdxIds", "fileName"] : [];
        for (const key of Object.keys(exception)) {
            if (!["reason", "reviewDate", ...allowed].includes(key)) throw new Error(`Unknown ${label} field: ${key}`);
        }
        if (kind === "license") {
            if (!["missing", "unrecognized", "spdx-mismatch"].includes(exception.condition)) {
                throw new Error("License exceptions require a missing, unrecognized, or spdx-mismatch condition.");
            }
            if (exception.spdxIds !== undefined &&
                (!Array.isArray(exception.spdxIds) || exception.spdxIds.length > 50 ||
                exception.spdxIds.some((id) => typeof id !== "string" || id.length > 100))) {
                throw new Error("License exception spdxIds must be a bounded array of strings.");
            }
            if (exception.condition === "spdx-mismatch" && !exception.spdxIds?.length) {
                throw new Error("A spdx-mismatch exception must list its applicable SPDX IDs.");
            }
            if (exception.fileName !== undefined && (typeof exception.fileName !== "string" ||
                !isWithinRoot(exception.fileName) || exception.fileName.includes("/"))) {
                throw new Error("License exception fileName must be a root-level filename.");
            }
        }
    }
}

export function boundedText(value, maxLength = 1000) {
    return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maxLength);
}

export function requiredObject(input, fields) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Action input must be an object.");
    for (const field of fields) {
        if (!(field in input)) throw new Error(`Action input is missing ${field}.`);
    }
    return input;
}
