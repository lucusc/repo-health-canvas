const identity = (repo, repositoryId) => ({
    host: "github.com", account: "demo-user", owner: "demo-user", repo, repositoryId,
});
const at21 = "2026-10-13T18:00:00Z";
const oneSecondUnder = "2026-10-13T18:00:01Z";
const oneSecondOver = "2026-10-13T17:59:59Z";

const pr = (number, title, createdAt, files = [], author = "dependabot[bot]") => ({
    number, title, user: { login: author }, state: "open", draft: false,
    created_at: createdAt, updated_at: createdAt,
    head: { ref: `automation/${number}`, sha: `head-${number}` },
    base: { ref: "main", sha: "base-sha" }, changedFiles: files,
});

export const fixtureCatalog = [
    { id: "standards", label: "Missing CODEOWNERS and custom license" },
    { id: "missing-license", label: "Missing license file" },
    { id: "existing-pr", label: "Existing standard-file pull request" },
    { id: "security-access", label: "Security-access failure" },
    { id: "multi-page", label: "Multi-page results and timestamps" },
];

export function loadFixture(id = "standards") {
    if (id === "standards") {
        return {
            repository: { identity: identity("fixture-standards", "990001"), url: "https://github.com/demo-user/fixture-standards", defaultBranch: "main", defaultBranchSha: "fixture-sha-1", archived: false },
            files: [
                { path: ".github/CODEOWNERS", state: "missing" },
                { path: "CODEOWNERS", state: "missing" },
                { path: "docs/CODEOWNERS", state: "missing" },
                { path: "LICENSE", state: "present", text: "Custom terms are provided by the repository owner.", htmlUrl: "https://github.com/demo-user/fixture-standards/blob/main/LICENSE" },
            ],
            codeownersErrors: { items: [], state: "available", completeness: "complete" },
            licenseRecognition: { state: "unavailable", status: 404 },
            dependencyPrs: { items: [], state: "available", completeness: "complete" },
            dependencyAlerts: { items: [], state: "available", completeness: "complete" },
            codeAlerts: { items: [], state: "available", completeness: "complete" },
            scannedAt: "2026-11-03T18:00:00Z",
        };
    }
    if (id === "existing-pr") {
        return {
            repository: { identity: identity("fixture-existing-pr", "990002"), url: "https://github.com/demo-user/fixture-existing-pr", defaultBranch: "main", defaultBranchSha: "fixture-sha-2", archived: false },
            files: [{ path: ".github/CODEOWNERS", state: "present", text: "* @demo-user" }, { path: "LICENSE", state: "present", text: "MIT License" }],
            codeownersErrors: { items: [], state: "available", completeness: "complete" },
            licenseRecognition: { state: "available", license: { spdx_id: "MIT", name: "MIT License" }, spdxId: "MIT" },
            dependencyPrs: { items: [pr(41, "Update standard configuration", at21, [".github/CODEOWNERS"], "automation[bot]")], state: "available", completeness: "complete" },
            dependencyAlerts: { items: [], state: "available", completeness: "complete" },
            codeAlerts: { items: [], state: "available", completeness: "complete" },
            scannedAt: "2026-11-03T18:00:00Z",
        };
    }
    if (id === "missing-license") {
        const fixture = loadFixture("standards");
        return {
            ...fixture,
            repository: { identity: identity("fixture-missing-license", "990005"), url: "https://github.com/demo-user/fixture-missing-license", defaultBranch: "main", defaultBranchSha: "fixture-sha-5", archived: false },
            files: [
                { path: ".github/CODEOWNERS", state: "present", text: "* @demo-user" },
                { path: "LICENSE", state: "missing" },
            ],
            licenseRecognition: { state: "unavailable", status: 404 },
        };
    }
    if (id === "security-access") {
        return {
            repository: { identity: identity("fixture-security-access", "990003"), url: "https://github.com/demo-user/fixture-security-access", defaultBranch: "main", defaultBranchSha: "fixture-sha-3", archived: false },
            files: [{ path: ".github/CODEOWNERS", state: "present", text: "* @demo-user" }, { path: "LICENSE", state: "present", text: "MIT License" }],
            codeownersErrors: { items: [], state: "available", completeness: "complete" },
            licenseRecognition: { state: "available", license: { spdx_id: "MIT" }, spdxId: "MIT" },
            dependencyPrs: { items: [], state: "available", completeness: "complete" },
            dependencyAlerts: { items: [], state: "policy-denied", completeness: "unavailable", error: { kind: "policy-denied", status: 403 } },
            codeAlerts: { items: [], state: "unavailable", completeness: "unavailable", error: { kind: "unavailable", status: 404 } },
            scannedAt: "2026-11-03T18:00:00Z",
        };
    }
    if (id === "multi-page") {
        return {
            repository: { identity: identity("fixture-multi-page", "990004"), url: "https://github.com/demo-user/fixture-multi-page", defaultBranch: "main", defaultBranchSha: "fixture-sha-4", archived: false },
            files: [{ path: ".github/CODEOWNERS", state: "present", text: "* @demo-user" }, { path: "LICENSE", state: "present", text: "MIT License" }],
            codeownersErrors: { items: [], state: "available", completeness: "complete" },
            licenseRecognition: { state: "available", license: { spdx_id: "MIT" }, spdxId: "MIT" },
            dependencyPrs: { items: [
                pr(51, "Update library alpha", oneSecondUnder),
                pr(52, "Update library beta", at21),
                pr(53, "Update library gamma", oneSecondOver),
            ], state: "available", completeness: "partial", pages: 5, truncated: true },
            dependencyAlerts: { items: [], state: "available", completeness: "partial", pages: 5, truncated: true },
            codeAlerts: { items: [], state: "available", completeness: "complete" },
            scannedAt: "2026-11-03T18:00:00Z",
        };
    }
    throw new Error("Unknown fixture. Choose one of the explicit fixture scenarios.");
}
