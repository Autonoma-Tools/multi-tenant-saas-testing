/**
 * Stubbed, in-memory export pipeline used by the background-job leakage test.
 *
 * Real background workers are the easiest place for cross-tenant leakage to
 * hide: they run out-of-band, often with elevated privileges, and rarely carry
 * the same request-scoped tenant guard the API enforces. This stub models a
 * test-mode job queue plus a tenant-scoped export handler so the isolation
 * invariant can be asserted without standing up a broker or a database.
 *
 * The invariant: an export job scoped to tenant X must never emit rows for a
 * resource owned by a different tenant, even if a caller enqueues an
 * out-of-scope invoice ID. In `strict` mode the job fails closed (no rows at
 * all); in non-strict mode it silently drops out-of-scope rows.
 */

export interface Invoice {
  id: string;
  tenantId: string;
  number: string;
  amountCents: number;
}

export interface ExportJob {
  id: string;
  tenantId: string;
  invoiceIds: string[];
}

export interface ExportRow {
  invoiceId: string;
  tenantId: string;
  number: string;
  amountCents: number;
}

export type ExportStatus = "completed" | "failed";

export interface ExportResult {
  jobId: string;
  tenantId: string;
  status: ExportStatus;
  rows: ExportRow[];
  /** Requested invoice IDs that were dropped because they are out of scope. */
  skipped: string[];
  error?: string;
}

export interface RunOptions {
  /**
   * When true (default), any out-of-scope invoice ID makes the whole job fail
   * closed and emit zero rows. When false, out-of-scope IDs are dropped and the
   * job completes with only the in-scope rows.
   */
  strict?: boolean;
}

/** Raised when a job requests resources it does not own. */
export class TenantIsolationError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly offendingInvoiceIds: string[],
  ) {
    super(
      `Job ${jobId} requested out-of-scope invoice(s): ${offendingInvoiceIds.join(", ")}`,
    );
    this.name = "TenantIsolationError";
  }
}

/** Minimal in-memory invoice store keyed by invoice ID. */
export class InvoiceStore {
  private readonly invoices = new Map<string, Invoice>();

  add(invoice: Invoice): this {
    this.invoices.set(invoice.id, invoice);
    return this;
  }

  get(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }
}

/**
 * Execute a single export job with tenant scoping enforced.
 *
 * An invoice is included only when it exists AND belongs to the job's tenant.
 * Everything else is recorded in `skipped`. In strict mode a non-empty
 * `skipped` set makes the job fail closed with zero rows.
 */
export function runExportJob(
  job: ExportJob,
  store: InvoiceStore,
  options: RunOptions = {},
): ExportResult {
  const strict = options.strict ?? true;

  const rows: ExportRow[] = [];
  const skipped: string[] = [];

  for (const invoiceId of job.invoiceIds) {
    const invoice = store.get(invoiceId);
    if (invoice && invoice.tenantId === job.tenantId) {
      rows.push({
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        number: invoice.number,
        amountCents: invoice.amountCents,
      });
    } else {
      skipped.push(invoiceId);
    }
  }

  if (strict && skipped.length > 0) {
    // Fail closed: refuse to emit ANY rows if the job reached across tenants.
    return {
      jobId: job.id,
      tenantId: job.tenantId,
      status: "failed",
      rows: [],
      skipped,
      error: new TenantIsolationError(job.id, skipped).message,
    };
  }

  return { jobId: job.id, tenantId: job.tenantId, status: "completed", rows, skipped };
}

/** A stubbed, synchronous, test-mode job queue. */
export class TestJobQueue {
  private jobs: ExportJob[] = [];

  enqueue(job: ExportJob): string {
    this.jobs.push(job);
    return job.id;
  }

  get size(): number {
    return this.jobs.length;
  }

  /** Run every enqueued job against the store, then clear the queue. */
  drain(store: InvoiceStore, options?: RunOptions): ExportResult[] {
    const results = this.jobs.map((job) => runExportJob(job, store, options));
    this.jobs = [];
    return results;
  }
}
