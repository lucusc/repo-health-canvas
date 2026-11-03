const ownerToken = /^(?:@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?)?|[^\s@]+@[^\s@]+)$/;

function globRegex(pattern) {
    const normalized = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
    let result = "^";
    for (let i = 0; i < normalized.length; i += 1) {
        const char = normalized[i];
        if (char === "*") {
            if (normalized[i + 1] === "*") {
                i += 1;
                result += ".*";
            } else {
                result += "[^/]*";
            }
        } else if (char === "?") {
            result += "[^/]";
        } else {
            result += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
        }
    }
    result += normalized.includes("/") ? "$" : "(?:/.*)?$";
    return new RegExp(result);
}

export function parseCodeowners(content) {
    const mappings = [];
    const errors = [];
    for (const [index, raw] of String(content ?? "").split(/\r?\n/).entries()) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const fields = line.split(/\s+/);
        const pattern = fields.shift();
        if (!pattern || fields.length === 0 || fields.some((owner) => !ownerToken.test(owner))) {
            errors.push({ line: index + 1, message: "Expected a path pattern and one or more valid owner tokens." });
            continue;
        }
        try {
            globRegex(pattern);
            mappings.push({ pattern, owners: fields.join(" "), line: index + 1 });
        } catch {
            errors.push({ line: index + 1, message: "Path pattern could not be interpreted." });
        }
    }
    return { mappings, errors };
}

export function findEffectiveCodeowners(files) {
    const precedence = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
    for (const path of precedence) {
        const file = files.find((candidate) => candidate.path === path);
        if (file?.state === "present") return { ...file, precedence };
        if (!file || !["missing"].includes(file.state)) {
            return { path: null, state: "unknown", blockedBy: path, precedence };
        }
    }
    return { path: null, state: "missing", precedence };
}

export function checkCodeownersPolicy(content, policyMappings = []) {
    const parsed = parseCodeowners(content);
    const policy = Array.isArray(policyMappings) ? policyMappings : [];
    const results = policy.map(({ pattern, owners }) => {
        const mapping = parsed.mappings.find((item) => item.pattern === pattern);
        return {
            pattern,
            expectedOwners: owners,
            actualOwners: mapping?.owners ?? null,
            status: !mapping ? "not-matched" : mapping.owners === owners ? "confirmed" : "mismatch",
        };
    });
    return {
        ...parsed,
        policyResults: results,
        status: parsed.errors.length ? "error" : parsed.mappings.length ? "needs-confirmation" : "empty",
    };
}
