import { beforeEach, describe, expect, it } from "vitest";
import {
  InvoiceStore,
  runExportJob,
  TenantIsolationError,
  TestJobQueue,
  type ExportJob,
} from "../../src/jobs/exportJob";

/**
 * Background-job cross-tenant leakage.
 *
 * We enqueue an export job scoped to Tenant A but deliberately point one of its
 * inputs at a Tenant B resource ID, then assert the job either fails closed
 * (strict mode) or returns zero rows for the out-of-scope resource (lenient
 * mode). Either way, Tenant B's data must never appear in Tenant A's export.
 *
 * This suite is fully self-contained: it needs no running server, so it also
 * runs standalone via `npm run test:jobs`.
 */

const TENANT_A = "tenant_acme";
const TENANT_B = "tenant_globex";

const ACME_INVOICE_ID = "inv_acme_1001";
const GLOBEX_INVOICE_ID = "inv_globex_2001";

function buildStore(): InvoiceStore {
  return new InvoiceStore()
    .add({ id: ACME_INVOICE_ID, tenantId: TENANT_A, number: "ACME-1001", amountCents: 129_900 })
    .add({ id: GLOBEX_INVOICE_ID, tenantId: TENANT_B, number: "GLOBEX-2001", amountCents: 543_200 });
}

describe("background-job cross-tenant isolation", () => {
  let store: InvoiceStore;
  let queue: TestJobQueue;

  beforeEach(() => {
    store = buildStore();
    queue = new TestJobQueue();
  });

  it("fails closed when a Tenant A job reaches for a Tenant B invoice (strict)", () => {
    const job: ExportJob = {
      id: "job_export_a_1",
      tenantId: TENANT_A,
      // One legitimate input plus one deliberately out-of-scope Tenant B ID.
      invoiceIds: [ACME_INVOICE_ID, GLOBEX_INVOICE_ID],
    };
    queue.enqueue(job);

    const results = queue.drain(store, { strict: true });
    expect(results).toHaveLength(1);
    const result = results[0]!;

    expect(result.status).toBe("failed");
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toEqual([GLOBEX_INVOICE_ID]);
    expect(result.error).toContain(GLOBEX_INVOICE_ID);
  });

  it("drops out-of-scope rows and never emits Tenant B data (lenient)", () => {
    const job: ExportJob = {
      id: "job_export_a_2",
      tenantId: TENANT_A,
      invoiceIds: [ACME_INVOICE_ID, GLOBEX_INVOICE_ID],
    };

    const result = runExportJob(job, store, { strict: false });

    expect(result.status).toBe("completed");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.invoiceId).toBe(ACME_INVOICE_ID);
    expect(result.rows.every((row) => row.tenantId === TENANT_A)).toBe(true);
    // The Tenant B invoice is out of scope: zero rows, recorded as skipped.
    expect(result.rows.some((row) => row.invoiceId === GLOBEX_INVOICE_ID)).toBe(false);
    expect(result.skipped).toContain(GLOBEX_INVOICE_ID);
  });

  it("returns zero rows for a job whose only input is out of scope", () => {
    const job: ExportJob = {
      id: "job_export_a_3",
      tenantId: TENANT_A,
      invoiceIds: [GLOBEX_INVOICE_ID],
    };

    const result = runExportJob(job, store, { strict: false });

    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toEqual([GLOBEX_INVOICE_ID]);
  });

  it("still exports the tenant's own invoices unharmed", () => {
    const job: ExportJob = {
      id: "job_export_a_4",
      tenantId: TENANT_A,
      invoiceIds: [ACME_INVOICE_ID],
    };

    const result = runExportJob(job, store);

    expect(result.status).toBe("completed");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.number).toBe("ACME-1001");
    expect(result.skipped).toHaveLength(0);
  });

  it("TenantIsolationError names the offending job and resources", () => {
    const error = new TenantIsolationError("job_export_a_1", [GLOBEX_INVOICE_ID]);
    expect(error.name).toBe("TenantIsolationError");
    expect(error.jobId).toBe("job_export_a_1");
    expect(error.offendingInvoiceIds).toEqual([GLOBEX_INVOICE_ID]);
  });
});
