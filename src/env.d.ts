interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  CAMU_BASE_URL: string;
  CAMU_LMS_URL: string;
  MIN_ATTENDANCE: string;
  MCP_SERVER_URL: string;
  // secrets
  CAMU_EMAIL: string;
  CAMU_PASSWORD: string;
  OWNER_PASSPHRASE: string;
}
