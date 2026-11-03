import { checkCodeownersPolicy, findEffectiveCodeowners, parseCodeowners } from "./codeowners.mjs";
import { MAX_FINDINGS, boundedText, safeRepoUrl } from "./validation.mjs";

function finding(id, category, title, sourceState, evidence = {}) {
    return {
        id: String(id),
        category,
        title: boundedText(title, 400),
        sourceState,
        assessment: "not-evaluated",
        workStatus: "needs-attention",
        evidence,
        updatedAt: evidence.updatedAt ?? null,
    };
}

function normalizePr(pr, identity, isDependabot) {
    const number = Number(pr.number);
    if (!Number.isSafeInteger(number) || number < 1) return null;
    const author = pr.user?.login;
    if (typeof author !== "string") return null;
    const url = safeRepoUrl(identity, `/pull/${number}`);
    return {
        id: `pr:${number}`,
        number,
        url,
        author: boundedText(author, 100),
        title: boundedText(pr.title, 500),
        createdAt: typeof pr.created_at === "string" ? pr.created_at : null,
        updatedAt: typeof pr.updated_at === "string" ? pr.updated_at : null,
        head: { ref: boundedText(pr.head?.ref, 200), sha: boundedText(pr.head?.sha, 100) },
        base: { ref: boundedText(pr.base?.ref, 200), sha: boundedText(pr.base?.sha, 100) },
        draft: Boolean(pr.draft),
        dependabot: isDependabot,
        state: boundedText(pr.state, 30),
        changedFiles: Array.isArray(pr.changedFiles) ? pr.changedFiles.map((path) => boundedText(path, 200)).slice(0, 100) : null,
    };
}

function matchesAuthor(author, configuredAuthors) {
    return configuredAuthors.some((identity) => identity.toLowerCase() === author.toLowerCase());
}

export function assessLicense(files, recognition, policy = {}) {
    const approvedFiles = policy.license?.approvedFileNames ?? ["LICENSE"];
    const candidates = files.filter((item) => approvedFiles.some((name) => name.toLowerCase() === item.path.toLowerCase()));
    const file = candidates.find((item) => item.state === "present") ?? candidates[0];
    const presence = candidates.some((item) => item.state === "present")
        ? "present"
        : approvedFiles.length > 0 && candidates.length === approvedFiles.length && candidates.every((item) => item.state === "missing")
            ? "missing"
            : "unknown";
    const recognized = recognition?.state === "available" ? Boolean(recognition.spdxId && recognition.spdxId !== "NOASSERTION") : null;
    const expected = policy.license?.expectedSpdxIds ?? [];
    let policyMatch = "not-evaluated";
    let exception = null;
    if (policy.license?.required !== undefined || expected.length) {
        if (presence === "unknown" || recognized === null) policyMatch = "unknown";
        else if (presence === "missing" && policy.license.required) policyMatch = "mismatch";
        else if (expected.length && (!recognized || !expected.includes(recognition.spdxId))) policyMatch = "mismatch";
        else policyMatch = "match";
    }
    if (policyMatch === "mismatch") {
        const referenceDate = String(policy.evaluatedAt ?? new Date().toISOString()).slice(0, 10);
        exception = (policy.license?.exceptions ?? []).find((item) => {
            if (item.reviewDate < referenceDate || item.fileName && item.fileName.toLowerCase() !== file?.path.toLowerCase()) return false;
            if (presence === "missing") return item.condition === "missing";
            if (recognized === false && item.condition === "unrecognized") return true;
            return item.condition === "spdx-mismatch" && item.spdxIds?.includes(recognition?.spdxId);
        }) ?? null;
        if (exception) policyMatch = "excepted";
    }
    return {
        presence,
        fileName: file?.path ?? null,
        githubRecognized: recognized,
        spdxId: recognition?.spdxId ?? null,
        policyMatch,
        exception: exception ? { reason: exception.reason, reviewDate: exception.reviewDate } : null,
        templateReference: policy.license?.templateReference ?? null,
    };
}

export function evaluateHealth(collection, policy = {}) {
    const identity = collection.repository.identity;
    const files = collection.files ?? [];
    const codeownersFile = findEffectiveCodeowners(files);
    let codeowners = { status: codeownersFile.state === "present" ? "needs-confirmation" : codeownersFile.state, path: codeownersFile.path, errors: [], policyResults: [] };
    if (codeownersFile.state === "present") {
        const parsed = parseCodeowners(codeownersFile.text);
        const parsedErrors = collection.codeownersErrors?.items ?? [];
        const reported = parsedErrors.map((item) => ({
            line: Number.isSafeInteger(item.line) ? item.line : null,
            message: boundedText(item.message, 500),
            path: boundedText(item.path, 200),
        }));
        const checks = checkCodeownersPolicy(codeownersFile.text, policy.confirmedCodeowners ?? []);
        codeowners = {
            ...checks,
            status: parsed.errors.length || reported.length ? "error" : "needs-confirmation",
            path: codeownersFile.path,
            githubErrors: reported,
        };
    }

    const license = assessLicense(files, collection.licenseRecognition, {
        ...policy,
        evaluatedAt: collection.scannedAt,
    });
    const standards = {
        codeowners,
        license,
        requiredFiles: (policy.requiredStandards ?? []).map((path) => {
            const file = files.find((item) => item.path === path);
            return { path, state: file?.state ?? "unknown" };
        }),
    };
    const dependabotAuthors = policy.dependabotAuthors ?? ["dependabot[bot]", "dependabot-preview[bot]"];
    const pullRequests = (collection.dependencyPrs?.items ?? [])
        .map((pr) => normalizePr(pr, identity, matchesAuthor(pr.user?.login ?? "", dependabotAuthors)))
        .filter(Boolean);
    const dependencyPrs = pullRequests.filter((pr) => pr.dependabot);
    const dependencyAlerts = (collection.dependencyAlerts?.items ?? []).map((alert) => ({
        id: `dependency-alert:${alert.number}`,
        number: alert.number,
        url: safeRepoUrl(identity, `/security/dependabot/${Number(alert.number)}`),
        state: boundedText(alert.state, 50),
        resolution: alert.state === "fixed" ? "fixed" : alert.state === "dismissed" ? "dismissed" : alert.state === "open" ? "open" : "unknown",
        resolutionReason: boundedText(alert.dismissed_reason ?? alert.dismissedReason ?? "", 100),
        fixedAt: typeof alert.fixed_at === "string" ? alert.fixed_at : null,
        severity: boundedText(alert.security_advisory?.severity ?? alert.security_vulnerability?.severity ?? "unknown", 40),
        advisory: boundedText(alert.security_advisory?.ghsa_id ?? alert.security_advisory?.cve_id ?? "", 100),
        summary: boundedText(alert.security_advisory?.summary ?? "", 500),
        manifest: boundedText(alert.dependency?.manifest_path ?? "", 200),
        createdAt: typeof alert.created_at === "string" ? alert.created_at : null,
    })).filter((alert) => Number.isSafeInteger(Number(alert.number)));
    const codeAlerts = (collection.codeAlerts?.items ?? []).map((alert) => ({
        id: `code-alert:${alert.number}`,
        number: alert.number,
        url: safeRepoUrl(identity, `/security/code-scanning/${Number(alert.number)}`),
        state: boundedText(alert.state, 50),
        resolution: alert.state === "fixed" ? "fixed" : alert.state === "dismissed" ? "dismissed" : alert.state === "open" ? "open" : "unknown",
        resolutionReason: boundedText(alert.dismissed_reason ?? alert.dismissedReason ?? "", 100),
        fixedAt: typeof alert.fixed_at === "string" ? alert.fixed_at : null,
        severity: boundedText(alert.rule?.security_severity_level ?? alert.rule?.severity ?? "unknown", 40),
        rule: boundedText(alert.rule?.id ?? alert.rule?.name ?? "", 150),
        location: boundedText(alert.most_recent_instance?.location?.path ?? "", 200),
        line: Number.isSafeInteger(alert.most_recent_instance?.location?.start_line) ? alert.most_recent_instance.location.start_line : null,
        createdAt: typeof alert.created_at === "string" ? alert.created_at : null,
    })).filter((alert) => Number.isSafeInteger(Number(alert.number)));

    const findings = [];
    findings.push(finding(`standards:codeowners:${codeowners.path ?? "unknown"}`, "standards", "CODEOWNERS status", codeowners.status, { path: codeowners.path, errors: codeowners.errors, policyResults: codeowners.policyResults, updatedAt: collection.scannedAt }));
    findings.push(finding("standards:license", "standards", "License status", license.presence, { ...license, updatedAt: collection.scannedAt }));
    for (const pr of dependencyPrs) findings.push(finding(pr.id, "dependency-pr", pr.title, "available", { pr }));
    for (const alert of dependencyAlerts) findings.push(finding(alert.id, "dependency-alert", alert.summary || alert.advisory || "Dependency alert", alert.state, { alert }));
    for (const alert of codeAlerts) findings.push(finding(alert.id, "code-alert", alert.rule || "Code-scanning alert", alert.state, { alert }));

    const collectionStatuses = {
        dependencyPrs: collection.dependencyPrs?.state ?? "not-checked",
        dependencyAlerts: collection.dependencyAlerts?.state ?? "not-checked",
        codeAlerts: collection.codeAlerts?.state ?? "not-checked",
        codeownersErrors: collection.codeownersErrors?.state ?? "not-checked",
    };
    const limitations = [];
    for (const [source, result] of Object.entries({
        dependencyPrs: collection.dependencyPrs,
        dependencyAlerts: collection.dependencyAlerts,
        codeAlerts: collection.codeAlerts,
        codeownersErrors: collection.codeownersErrors,
    })) {
        if (result?.completeness === "partial") limitations.push(`${source} collection is incomplete; ${result.items?.length ?? 0} items loaded.`);
        if (result?.state && result.state !== "available") limitations.push(`${source} is ${result.state}; results are not a zero/healthy signal.`);
    }
    for (const file of files) {
        if (file.state === "missing") limitations.push(`${file.path} is confirmed missing in the collected evidence.`);
        else if (file.state !== "present") limitations.push(`${file.path} is ${file.state}; absence is not confirmed.`);
    }
    const standardFileCandidates = pullRequests.filter((pr) => !pr.dependabot);
    const existingPrLookup = {
        candidates: standardFileCandidates,
        completeness: collection.dependencyPrs?.completeness ?? "unavailable",
        state: "not-inspected",
        limitation: "Open pull requests have not been checked for changed paths; absence of a related PR cannot be confirmed.",
    };
    return {
        identity,
        repositoryUrl: collection.repository.url,
        defaultBranch: collection.repository.defaultBranch,
        defaultBranchSha: collection.repository.defaultBranchSha,
        archived: collection.repository.archived,
        scannedAt: collection.scannedAt,
        standards,
        dependencyPrs: { items: dependencyPrs, completeness: collection.dependencyPrs?.completeness ?? "unavailable", state: collectionStatuses.dependencyPrs },
        openPullRequests: pullRequests,
        dependencyAlerts: { items: dependencyAlerts, completeness: collection.dependencyAlerts?.completeness ?? "unavailable", state: collectionStatuses.dependencyAlerts },
        codeAlerts: { items: codeAlerts, completeness: collection.codeAlerts?.completeness ?? "unavailable", state: collectionStatuses.codeAlerts },
        existingPrLookup,
        collectionStatuses,
        limitations,
        findings: findings.slice(0, MAX_FINDINGS),
    };
}

export function mergeAssessment(previous, next) {
    const successful = Object.values(next.collectionStatuses).some((state) => state === "available");
    if (!successful && previous?.scannedAt) {
        const stale = { ...previous, stale: true, originalScannedAt: previous.scannedAt };
        stale.collectionStatuses = next.collectionStatuses;
        stale.error = "Refresh failed; showing the previous successful snapshot as stale.";
        stale.lastAttemptAt = next.lastAttemptAt;
        for (const source of ["dependencyPrs", "dependencyAlerts", "codeAlerts"]) {
            stale[source] = {
                ...previous[source],
                state: next.collectionStatuses[source],
                stale: true,
                originalScannedAt: previous.scannedAt,
            };
        }
        stale.findings = (previous.findings ?? []).map((item) => ({
            ...item, stale: true, originalScannedAt: previous.scannedAt,
        }));
        return {
            ...stale,
            limitations: [...(previous.limitations ?? []), ...next.limitations],
        };
    }
    const merged = { ...next, stale: false, originalScannedAt: null };
    if (!successful) {
        merged.scannedAt = previous?.scannedAt ?? null;
        merged.lastAttemptAt = next.lastAttemptAt ?? null;
    }
    const retainedLimitations = [];
    for (const [source, property] of [
        ["dependencyPrs", "dependencyPrs"],
        ["dependencyAlerts", "dependencyAlerts"],
        ["codeAlerts", "codeAlerts"],
    ]) {
        if (next.collectionStatuses[source] === "available" || !previous?.[property]?.items?.length) continue;
        const old = previous[property];
        merged[property] = {
            ...old,
            state: next.collectionStatuses[source],
            stale: true,
            originalScannedAt: previous.scannedAt,
        };
        retainedLimitations.push(`${source} is unavailable now; showing prior data from ${previous.scannedAt} as stale.`);
    }
    if (retainedLimitations.length) {
        const staleIds = new Set([
            ...(merged.dependencyPrs?.stale ? merged.dependencyPrs.items.map((item) => item.id) : []),
            ...(merged.dependencyAlerts?.stale ? merged.dependencyAlerts.items.map((item) => item.id) : []),
            ...(merged.codeAlerts?.stale ? merged.codeAlerts.items.map((item) => item.id) : []),
        ]);
        const nextById = new Map((next.findings ?? []).map((item) => [item.id, item]));
        for (const oldFinding of previous.findings ?? []) {
            if (staleIds.has(oldFinding.id) && !nextById.has(oldFinding.id)) {
                nextById.set(oldFinding.id, { ...oldFinding, stale: true, originalScannedAt: previous.scannedAt });
            }
        }
        merged.findings = [...nextById.values()];
        merged.limitations = [...(merged.limitations ?? []), ...retainedLimitations];
    }
    if (previous?.findings?.length && merged.findings) {
        const previousById = new Map(previous.findings.map((item) => [item.id, item]));
        merged.findings = merged.findings.map((item) => {
            const old = previousById.get(item.id);
            return old ? { ...item, workStatus: old.workStatus, progressReferences: old.progressReferences } : item;
        });
    }
    return merged;
}

export function summarizePr(pr) {
    return normalizePr(pr, pr.identity, true);
}
