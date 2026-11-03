import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { HealthService } from "./src/service.mjs";
import { startCanvasServer } from "./src/server.mjs";

const repositoriesSchema = {
    type: "array",
    minItems: 1,
    maxItems: 20,
    items: {
        type: "object",
        additionalProperties: false,
        required: ["host", "account", "owner", "repo"],
        properties: {
            host: { type: "string", minLength: 1, maxLength: 255 },
            account: { type: "string", minLength: 1, maxLength: 100 },
            owner: { type: "string", minLength: 1, maxLength: 100 },
            repo: { type: "string", minLength: 1, maxLength: 100 },
            repositoryId: { type: "string", pattern: "^\\d{1,20}$" },
        },
    },
};

const noInput = {
    type: "object",
    additionalProperties: false,
    properties: {},
};

const canvases = [];
let resolveService;
const serviceReady = new Promise((resolve) => { resolveService = resolve; });
const servers = new Map();

canvases.push(createCanvas({
    id: "repo-health",
    displayName: "Repo Health -> Take Action",
    description: "Review read-only repository health evidence and prepare a bounded action brief.",
    inputSchema: {
        oneOf: [
            {
                type: "object",
                additionalProperties: false,
                required: ["mode", "repositories"],
                properties: {
                    mode: { const: "live" },
                    repositories: repositoriesSchema,
                },
            },
            {
                type: "object",
                additionalProperties: false,
                required: ["mode", "fixtureId"],
                properties: {
                    mode: { const: "fixture" },
                    fixtureId: { type: "string", enum: ["standards", "missing-license", "existing-pr", "security-access", "multi-page"] },
                },
            },
        ],
    },
    actions: [
        {
            name: "get_health",
            description: "Get the current selected repository, assessment, source timestamps, completeness, and findings.",
            inputSchema: noInput,
            handler: async ({ instanceId }) => (await serviceReady).getHealth(instanceId),
        },
        {
            name: "refresh_health",
            description: "Refresh authorized read-only evidence for the selected repository.",
            inputSchema: noInput,
            handler: async ({ instanceId }) => (await serviceReady).refreshHealth(instanceId),
        },
        {
            name: "select_finding",
            description: "Select a finding by stable ID in the current repository and data mode.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["findingId", "expectedRevision"],
                properties: {
                    findingId: { type: "string", minLength: 1, maxLength: 200 },
                    expectedRevision: { type: "integer", minimum: 0 },
                },
            },
            handler: async ({ instanceId, input }) => (await serviceReady).selectFinding(instanceId, input),
        },
        {
            name: "get_selected_task",
            description: "Return the current selected finding and saved editable task brief.",
            inputSchema: noInput,
            handler: async ({ instanceId }) => (await serviceReady).getSelectedTask(instanceId),
        },
        {
            name: "prepare_action",
            description: "Save a bounded action brief and return a copyable, non-dispatched handoff.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["requestedTask", "targetRef", "allowedScope", "constraints", "completionCriteria", "expectedRevision"],
                properties: {
                    findingId: { type: "string", maxLength: 200 },
                    requestedTask: { type: "string", minLength: 1, maxLength: 800 },
                    targetRef: { type: "string", minLength: 1, maxLength: 200 },
                    allowedScope: { type: "string", minLength: 1, maxLength: 800 },
                    constraints: { type: "string", minLength: 1, maxLength: 1000 },
                    completionCriteria: { type: "string", minLength: 1, maxLength: 800 },
                    expectedRevision: { type: "integer", minimum: 0 },
                },
            },
            handler: async ({ instanceId, input }) => (await serviceReady).prepareAction(instanceId, input),
        },
        {
            name: "update_task_progress",
            description: "Update work tracking without claiming verified resolution.",
            inputSchema: {
                type: "object",
                additionalProperties: false,
                required: ["status", "expectedRevision"],
                properties: {
                    findingId: { type: "string", maxLength: 200 },
                    status: { type: "string", enum: ["needs-attention", "investigating", "change-proposed", "awaiting-review"] },
                    evidenceReferences: { type: "array", maxItems: 10, items: { type: "string", maxLength: 500 } },
                    expectedRevision: { type: "integer", minimum: 0 },
                },
            },
            handler: async ({ instanceId, input }) => (await serviceReady).updateTaskProgress(instanceId, input),
        },
        {
            name: "get_dependency_prs",
            description: "Get the current unfiltered dependency pull-request list with completeness and canonical references.",
            inputSchema: noInput,
            handler: async ({ instanceId }) => (await serviceReady).getDependencyPrs(instanceId),
        },
    ],
    open: async (context) => {
        const service = await serviceReady;
        let entry = servers.get(context.instanceId);
        if (!entry) {
            try {
                entry = await startCanvasServer({
                    service,
                    instanceId: context.instanceId,
                    input: context.input,
                });
                servers.set(context.instanceId, entry);
            } catch (error) {
                await service.closeInstance(context.instanceId);
                throw error;
            }
        } else {
            await service.openInstance(context.instanceId, context.input);
        }
        return {
            url: entry.url,
            title: "Repo Health -> Take Action",
            status: "ready",
        };
    },
    onClose: async ({ instanceId }) => {
        const service = await serviceReady;
        const entry = servers.get(instanceId);
        if (!entry) {
            await service.closeInstance(instanceId);
            return;
        }
        servers.delete(instanceId);
        await entry.close();
    },
}));

const session = await joinSession({ canvases });
resolveService(new HealthService({
    workspacePath: session.workspacePath ?? process.cwd(),
}));
