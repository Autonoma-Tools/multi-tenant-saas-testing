import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Shared configuration, types, and helpers for the cross-tenant isolation suite.
 *
 * Every fixture and test in this repo imports from here so that the seed script,
 * the teardown script, and the UI/API/job leakage tests all agree on the same
 * environment variables, admin-API shape, and tenant-scoped IDs.
 *
 * This module deliberately depends on Node built-ins only (node:fs, node:path,
 * global fetch) so the seed/teardown fixtures stay dependency-free.
 */

export type TenantKey = "acme" | "globex";

export interface SeededUser {
  id: string;
  email: string;
  password: string;
}

export interface SeededInvoice {
  id: string;
  number: string;
  amountCents: number;
  currency: string;
}

export interface TenantSeed {
  key: TenantKey;
  id: string;
  name: string;
  slug: string;
  user: SeededUser;
  invoice: SeededInvoice;
}

export interface SeedState {
  createdAt: string;
  baseUrl: string;
  tenants: Record<TenantKey, TenantSeed>;
}

/** Base URL of the multi-tenant app under test (no trailing slash). */
export const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** Privileged token used ONLY by the seed/teardown fixtures to manage tenants. */
export const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN ?? "";

/** Shared password assigned to both seeded tenant users (UI + API login). */
export const DEFAULT_TENANT_PASSWORD = process.env.TENANT_USER_PASSWORD ?? "isolation-suite-pw";

/** Where the seed script records created IDs for the test suite to consume. */
export const SEED_STATE_PATH = resolve(process.env.SEED_STATE_PATH ?? ".seed-state.json");

/**
 * Static definitions for the two isolated tenants. Two is the minimum needed to
 * prove isolation: authenticate as one, then try to reach the other's data.
 */
export const TENANT_DEFINITIONS = [
  {
    key: "acme",
    name: "Acme, Inc.",
    slug: "acme",
    userEmail: "owner@acme.example",
    invoiceNumber: "ACME-1001",
    amountCents: 129_900,
    currency: "USD",
  },
  {
    key: "globex",
    name: "Globex Corporation",
    slug: "globex",
    userEmail: "owner@globex.example",
    invoiceNumber: "GLOBEX-2001",
    amountCents: 543_200,
    currency: "USD",
  },
] as const satisfies ReadonlyArray<{
  key: TenantKey;
  name: string;
  slug: string;
  userEmail: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
}>;

/** Throw a clear, actionable error if the admin token is missing. */
export function requireAdminToken(): void {
  if (!ADMIN_API_TOKEN) {
    throw new Error(
      "ADMIN_API_TOKEN is not set. Copy .env.example to .env, set ADMIN_API_TOKEN, " +
        "and export it before running the seed/teardown fixtures.",
    );
  }
}

/** Fetch against the admin API with the admin bearer token attached. */
export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${ADMIN_API_TOKEN}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** Persist created IDs so every test consumes the same tenant-scoped resources. */
export function writeSeedState(state: SeedState): void {
  const dir = dirname(SEED_STATE_PATH);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(SEED_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Read the seed state, failing loudly if the suite was run before seeding. */
export function readSeedState(): SeedState {
  if (!existsSync(SEED_STATE_PATH)) {
    throw new Error(
      `Seed state not found at ${SEED_STATE_PATH}. ` +
        "Run `npm run seed` (npx tsx fixtures/seedTenants.ts) before the leakage tests.",
    );
  }
  return JSON.parse(readFileSync(SEED_STATE_PATH, "utf8")) as SeedState;
}

/** Remove the local seed-state file after teardown. */
export function clearSeedState(): void {
  if (existsSync(SEED_STATE_PATH)) {
    rmSync(SEED_STATE_PATH);
  }
}
