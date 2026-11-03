import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_FINDINGS, normalizeIdentity, scopeKey } from "./validation.mjs";

const locks = new Map();

function defaultState(identity, mode) {
    return {
        schemaVersion: 1,
        revision: 0,
        identity: normalizeIdentity(identity),
        mode,
        scannedAt: null,
        defaultBranchSha: null,
        findings: [],
        selectedFindingId: null,
        taskBriefs: {},
        stale: false,
        limitations: [],
        error: null,
    };
}

export class StateStore {
    constructor(directory, allowedHosts = []) {
        this.directory = directory;
        this.allowedHosts = allowedHosts;
    }

    key(identity, mode) {
        return scopeKey(identity, mode, this.allowedHosts);
    }

    async read(identity, mode) {
        const key = this.key(identity, mode);
        const path = join(this.directory, `${encodeURIComponent(key)}.json`);
        try {
            const state = JSON.parse(await readFile(path, "utf8"));
            if (state.schemaVersion !== 1 || state.mode !== mode || this.key(state.identity, state.mode) !== key) {
                throw new Error("Saved health state failed integrity checks.");
            }
            return state;
        } catch (error) {
            if (error.code === "ENOENT") return defaultState(identity, mode);
            throw error;
        }
    }

    async update(identity, mode, expectedRevision, mutator) {
        const key = this.key(identity, mode);
        const previousLock = locks.get(key) ?? Promise.resolve();
        let release;
        const currentLock = new Promise((resolve) => { release = resolve; });
        const chainedLock = previousLock.then(() => currentLock);
        locks.set(key, chainedLock);
        await previousLock;
        try {
            const state = await this.read(identity, mode);
            if (expectedRevision !== undefined && state.revision !== expectedRevision) {
                const error = new Error("State changed since it was read; refresh and retry.");
                error.code = "stale_revision";
                throw error;
            }
            const next = await mutator(structuredClone(state));
            if (!next || next.mode !== mode || this.key(next.identity, next.mode) !== key ||
                !Array.isArray(next.findings) || next.findings.length > MAX_FINDINGS ||
                !next.taskBriefs || typeof next.taskBriefs !== "object" || Array.isArray(next.taskBriefs) ||
                Object.keys(next.taskBriefs).length > 100) {
                throw new Error("State update violated repository or size constraints.");
            }
            next.revision = state.revision + 1;
            const path = join(this.directory, `${encodeURIComponent(key)}.json`);
            await mkdir(dirname(path), { recursive: true });
            const temporary = `${path}.${randomUUID()}.tmp`;
            await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", flag: "wx", mode: 0o600 });
            await rename(temporary, path);
            return next;
        } finally {
            release();
            if (locks.get(key) === chainedLock) locks.delete(key);
        }
    }
}

export function createDefaultState(identity, mode) {
    return defaultState(identity, mode);
}
