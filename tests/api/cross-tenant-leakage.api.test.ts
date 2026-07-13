import { beforeAll, describe, expect, it } from "vitest";
import { BASE_URL, readSeedState, type SeedState } from "../../fixtures/shared";

/**
 * API cross-tenant leakage.
 *
 * Authenticate as Tenant A's user, then directly request Tenant B's invoice,
 * user, and export endpoints by ID. Each MUST return 403 or 404 and MUST NEVER
 * return 200 with another tenant's data. Direct object references (IDOR) are
 * the classic multi-tenant leak, so we probe them explicitly.
 *
 * Requires a running app at BASE_URL and a prior `npm run seed`.
 */

/** Cross-tenant access is only acceptable as an explicit denial. */
const DENIED_STATUSES = [401, 403, 404] as const;

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Login failed for ${email}: ${res.status} ${res.statusText} ${detail}`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) {
    throw new Error(`Login for ${email} returned no token.`);
  }
  return body.token;
}

function authedGet(path: string, token: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
}

describe("API cross-tenant isolation", () => {
  let state: SeedState;
  let tokenA: string;

  beforeAll(async () => {
    state = readSeedState();
    // Log in as Tenant A. Every request below carries Tenant A's credentials.
    tokenA = await login(state.tenants.acme.user.email, state.tenants.acme.user.password);
  });

  it("lets Tenant A read its OWN invoice (control)", async () => {
    const res = await authedGet(`/api/invoices/${state.tenants.acme.invoice.id}`, tokenA);
    expect(res.status).toBe(200);
  });

  it("blocks Tenant A from reading Tenant B's invoice", async () => {
    const targetId = state.tenants.globex.invoice.id;
    const res = await authedGet(`/api/invoices/${targetId}`, tokenA);

    expect(res.status).not.toBe(200);
    expect(DENIED_STATUSES).toContain(res.status);

    // Defense in depth: even if a proxy rewrote the status, the body must not
    // carry Globex's invoice number.
    const text = await res.text().catch(() => "");
    expect(text).not.toContain(state.tenants.globex.invoice.number);
  });

  it("blocks Tenant A from reading Tenant B's user", async () => {
    const res = await authedGet(`/api/users/${state.tenants.globex.user.id}`, tokenA);

    expect(res.status).not.toBe(200);
    expect(DENIED_STATUSES).toContain(res.status);

    const text = await res.text().catch(() => "");
    expect(text).not.toContain(state.tenants.globex.user.email);
  });

  it("blocks Tenant A from exporting Tenant B's invoice", async () => {
    const res = await authedGet(`/api/exports/${state.tenants.globex.invoice.id}`, tokenA);

    expect(res.status).not.toBe(200);
    expect(DENIED_STATUSES).toContain(res.status);
  });
});
