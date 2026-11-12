import OAuthProvider, { type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { createServer } from "./mcp";
import { VERSION } from "./version";

// Only you can approve a connector: the approval page asks for OWNER_PASSPHRASE.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'; form-action *",
  "Cache-Control": "no-store",
};

function page(client: string, state: string, error?: string) {
  return new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Approve connector</title>
<style>body{font:16px system-ui;max-width:26rem;margin:12vh auto;padding:0 16px}input,button{font:inherit;width:100%;padding:.6rem;margin:.4rem 0;box-sizing:border-box}.e{color:#b00020}</style>
<h2>Connect to MyCamu</h2>
<p><b>${esc(client)}</b> wants to read your MyCamu timetable, attendance and course files.</p>
${error ? `<p class=e>${esc(error)}</p>` : ""}
<form method=post>
<input type=hidden name=state value="${esc(state)}">
<input type=password name=passphrase placeholder="Your passphrase" autocomplete=current-password required autofocus>
<button>Approve</button></form>`, { headers: HEADERS });
}

const authHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/authorize") return new Response(`MyCamu ${VERSION} is running. Add /mcp as a connector.`, { status: 200 });

    if (request.method === "GET") {
      const req = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const client = await env.OAUTH_PROVIDER.lookupClient(req.clientId);
      return page(client?.clientName ?? req.clientId, btoa(JSON.stringify(req)));
    }

    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const form = await request.formData();
    const state = String(form.get("state") ?? "");
    let req: AuthRequest;
    try { req = JSON.parse(atob(state)); } catch { return new Response("Bad request", { status: 400 }); }
    const client = await env.OAUTH_PROVIDER.lookupClient(req.clientId);
    const name = client?.clientName ?? req.clientId;

    // Lock out after 5 wrong guesses per IP per 15 minutes.
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const rlKey = `rl:${ip}`;
    const fails = Number((await env.OAUTH_KV.get(rlKey)) ?? 0);
    if (fails >= 5) return page(name, state, "Too many attempts. Try again in 15 minutes.");

    if (!env.OWNER_PASSPHRASE || !safeEqual(String(form.get("passphrase") ?? ""), env.OWNER_PASSPHRASE)) {
      await env.OAUTH_KV.put(rlKey, String(fails + 1), { expirationTtl: 900 });
      return page(name, state, "Wrong passphrase.");
    }
    await env.OAUTH_KV.delete(rlKey);

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: req, userId: "owner", metadata: { label: "MyCamu owner" }, scope: req.scope, props: { userId: "owner" },
    });
    return Response.redirect(redirectTo, 302);
  },
};

const mcpHandler: ExportedHandlerWithFetch = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createMcpHandler(() => createServer(env))(request, env, ctx);
  },
};
type ExportedHandlerWithFetch = { fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> };

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler as any,
  defaultHandler: authHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  // Public HTTPS address of the /mcp endpoint, set in wrangler.jsonc after the first deploy.
  resourceMetadata: { resource: (env as unknown as Env).MCP_SERVER_URL, resource_name: "MyCamu" },
});
