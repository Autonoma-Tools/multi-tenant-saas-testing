import {
  adminFetch,
  BASE_URL,
  DEFAULT_TENANT_PASSWORD,
  requireAdminToken,
  TENANT_DEFINITIONS,
  writeSeedState,
  type SeedState,
  type TenantKey,
  type TenantSeed,
} from "./shared";

/**
 * Seed two fully isolated tenants (Acme + Globex), each with one user and one
 * invoice, via the admin API. Created IDs are written to the seed-state file
 * AND printed as JSON to stdout so the UI/API leakage tests can consume them.
 *
 * Uses built-in Node `fetch` only. Run with: `npx tsx fixtures/seedTenants.ts`.
 */

interface CreatedResource {
  id: string;
}

async function postJson(path: string, body: unknown, label: string): Promise<CreatedResource> {
  const res = await adminFetch(path, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Failed to create ${label} (POST ${path}): ${res.status} ${res.statusText} ${detail}`);
  }
  const created = (await res.json()) as Partial<CreatedResource>;
  if (!created?.id) {
    throw new Error(`Admin API returned no id when creating ${label} (POST ${path}).`);
  }
  return { id: created.id };
}

async function seedTenant(def: (typeof TENANT_DEFINITIONS)[number]): Promise<TenantSeed> {
  const tenant = await postJson(
    "/admin/tenants",
    { name: def.name, slug: def.slug },
    `tenant "${def.slug}"`,
  );

  const user = await postJson(
    `/admin/tenants/${tenant.id}/users`,
    { email: def.userEmail, password: DEFAULT_TENANT_PASSWORD },
    `user for tenant "${def.slug}"`,
  );

  const invoice = await postJson(
    `/admin/tenants/${tenant.id}/invoices`,
    { number: def.invoiceNumber, amountCents: def.amountCents, currency: def.currency },
    `invoice for tenant "${def.slug}"`,
  );

  return {
    key: def.key,
    id: tenant.id,
    name: def.name,
    slug: def.slug,
    user: { id: user.id, email: def.userEmail, password: DEFAULT_TENANT_PASSWORD },
    invoice: {
      id: invoice.id,
      number: def.invoiceNumber,
      amountCents: def.amountCents,
      currency: def.currency,
    },
  };
}

async function main(): Promise<void> {
  requireAdminToken();

  const tenants = {} as Record<TenantKey, TenantSeed>;
  for (const def of TENANT_DEFINITIONS) {
    tenants[def.key] = await seedTenant(def);
  }

  const state: SeedState = {
    createdAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    tenants,
  };

  writeSeedState(state);

  // Emit the created IDs as JSON for the suite (and CI logs) to consume.
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[seed] ${message}\n`);
  process.exitCode = 1;
});
