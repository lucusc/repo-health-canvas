import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { renderPage } from "./ui.mjs";
import { requiredObject } from "./validation.mjs";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const LOOPBACKS = new Set(["127.0.0.1", "::ffff:127.0.0.1", "::1"]);

function sameSecret(actual, expected) {
    if (typeof actual !== "string" || actual.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function sendJson(response, status, value) {
    let body = JSON.stringify(value);
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
        status = 413;
        body = JSON.stringify({ error: "Canvas response exceeds the configured size limit." });
    }
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    });
    response.end(body);
}

async function readJson(request) {
    const declared = Number(request.headers["content-length"] ?? 0);
    if (declared > MAX_REQUEST_BYTES) throw new Error("Request body exceeds the allowed size.");
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) throw new Error("Request body exceeds the allowed size.");
        chunks.push(chunk);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Request body must be a JSON object.");
    return parsed;
}

export async function startCanvasServer({ service, instanceId, input }) {
    await service.openInstance(instanceId, input);
    const token = randomBytes(32).toString("base64url");
    const nonce = randomBytes(18).toString("base64");
    let server;
    server = createServer(async (request, response) => {
        const address = request.socket.remoteAddress;
        if (!LOOPBACKS.has(address)) {
            sendJson(response, 403, { error: "Loopback access only." });
            return;
        }
        const boundAddress = server.address();
        const expectedHost = `127.0.0.1:${boundAddress.port}`;
        if (request.headers.host !== expectedHost) {
            sendJson(response, 403, { error: "Host header was rejected." });
            return;
        }
        const origin = `http://${expectedHost}`;
        if (request.headers.origin && request.headers.origin !== origin) {
            sendJson(response, 403, { error: "Origin was rejected." });
            return;
        }
        const url = new URL(request.url, origin);
        if (request.method === "GET" && url.pathname === "/") {
            response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'`,
            });
            response.end(renderPage({ token, nonce }));
            return;
        }
        const authorization = request.headers.authorization;
        const providedToken = typeof authorization === "string" && authorization.startsWith("Bearer ")
            ? authorization.slice(7)
            : "";
        if (!sameSecret(providedToken, token)) {
            sendJson(response, 403, { error: "Canvas request authentication failed." });
            return;
        }
        try {
            if (request.method === "GET" && url.pathname === "/api/state") {
                sendJson(response, 200, await service.getHealth(instanceId));
                return;
            }
            if (request.method !== "POST") {
                sendJson(response, 404, { error: "Route not found." });
                return;
            }
            if (request.headers["x-csrf-token"] !== token || request.headers.origin !== origin) {
                sendJson(response, 403, { error: "CSRF validation failed." });
                return;
            }
            const body = await readJson(request);
            let result;
            if (url.pathname === "/api/refresh") result = await service.refreshHealth(instanceId);
            else if (url.pathname === "/api/select") {
                requiredObject(body, ["findingId", "expectedRevision"]);
                result = await service.selectFinding(instanceId, body);
            } else if (url.pathname === "/api/prepare") {
                requiredObject(body, ["requestedTask", "targetRef", "allowedScope", "constraints", "completionCriteria", "expectedRevision"]);
                result = await service.prepareAction(instanceId, body);
            } else if (url.pathname === "/api/progress") {
                requiredObject(body, ["status", "expectedRevision"]);
                result = await service.updateTaskProgress(instanceId, body);
            } else if (url.pathname === "/api/switch") {
                requiredObject(body, ["mode", "index", "fixtureId"]);
                result = await service.switchRepository(instanceId, body);
            } else {
                sendJson(response, 404, { error: "Route not found." });
                return;
            }
            sendJson(response, 200, result);
        } catch (error) {
            const status = error.code === "stale_revision" ? 409 : 400;
            sendJson(response, status, { error: String(error.message).slice(0, 500) });
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    return {
        server,
        url: `http://127.0.0.1:${port}/`,
        close: async () => {
            await service.closeInstance(instanceId);
            if (!server.listening) return;
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        },
    };
}
