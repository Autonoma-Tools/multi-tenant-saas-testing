import { adminFetch, clearSeedState, readSeedState, requireAdminToken, type TenantSeed } from "./shared";

/**
 * Delete both seeded tenants and every resource they own (users + invoices)
 * via the admin API, so leakage tests never accumulate stale data.
 *
 * A tenant that is already gone (404) is treated as success, which keeps this
 * safe to run repeatedly and inside a CI `if: always()` step.
 *
 * Uses built-in Node `fetch` only. Run with: `npx tsx fixtures/teardownTenants.ts`.
 */

interface TeardownResult {
  key: string;
  id: string;
  status: number;
  deleted: boolean;
}

async function deleteTenant(tenant: TenantSeed): Promise<TeardownResult> {
  const res = await adminFetch(`/admin/tenants/${tenant.id}`, { method: "DELETE" });

  // 404 means it was already removed; anything else that is not OK is a failure.
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Failed to delete tenant "${tenant.slug}" (DELETE /admin/tenants/${tenant.id}): ` +
        `${res.status} ${res.statusText} ${detail}`,
    );
  }

  return { key: tenant.key, id: tenant.id, status: res.status, deleted: res.status !== 404 };
}

async function main(): Promise<void> {
  requireAdminToken();

  const state = readSeedState();
  const results: TeardownResult[] = [];
  for (const tenant of Object.values(state.tenants)) {
    results.push(await deleteTenant(tenant));
  }

  clearSeedState();
  process.stdout.write(`${JSON.stringify({ tornDown: results }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[teardown] ${message}\n`);
  process.exitCode = 1;
});
