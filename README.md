# Why Multi-Tenant SaaS Testing Starts with Data Isolation

Runnable cross-tenant data-isolation test suite for multi-tenant SaaS: two-tenant seed/teardown fixtures plus leakage assertions across the UI (Playwright), the API (vitest), and background jobs, wired into a GitHub Actions workflow that seeds, tests, and tears down on every PR.

> Companion code for the Autonoma blog post: **[Why Multi-Tenant SaaS Testing Starts with Data Isolation](https://getautonoma.com/blog/multi-tenant-saas-testing)**

## Requirements

Node 20+ and TypeScript. To run the UI and API suites you also need a running instance of the multi-tenant app under test reachable at `BASE_URL`, plus an `ADMIN_API_TOKEN` with permission to create and delete tenants. The background-job suite (`npm run test:jobs`) is fully self-contained and needs neither.

## Quickstart

```bash
git clone https://github.com/Autonoma-Tools/multi-tenant-saas-testing.git
cd multi-tenant-saas-testing
# 1. Install dev dependencies (Node 20+).
npm install
npx playwright install chromium

# 2. Point the suite at your app + admin API.
cp .env.example .env         # set BASE_URL + ADMIN_API_TOKEN, then export them
set -a; source .env; set +a

# 3. Seed two isolated tenants (Acme + Globex), each with a user and an invoice.
npm run seed

# 4. Run the leakage suites.
npm run test:jobs            # self-contained, no server required
npm run test:api             # cross-tenant API reads must return 403/404, never 200
npm run test:e2e             # Tenant A cannot open Tenant B's invoice URL

# 5. Always tear the tenants down so leakage tests never accumulate stale data.
npm run teardown

# Shortcut: examples/run-locally.sh runs steps 3-5 with teardown on exit.
```

## The two-tenant seed -> test -> teardown flow

Isolation is only provable with at least two tenants: you authenticate as one and
try to reach the other's data. The suite is built around that idea.

1. **Seed** (`fixtures/seedTenants.ts`) creates two isolated tenants, **Acme** and
   **Globex**, each with one user and one invoice, via the admin API using
   `ADMIN_API_TOKEN`. It writes the created IDs to `.seed-state.json` and prints
   them as JSON so every test consumes the same tenant-scoped resources.
2. **Test** — three suites each try to cross the tenant boundary:
   - **UI** (`tests/e2e/cross-tenant-leakage.spec.ts`, Playwright): log in as Acme,
     navigate directly to Globex's invoice URL, assert a not-found / access-denied
     state instead of Globex's data.
   - **API** (`tests/api/cross-tenant-leakage.api.test.ts`, vitest): authenticate as
     Acme, request Globex's invoice, user, and export endpoints by ID, assert each
     returns 403 or 404 and never 200.
   - **Background jobs** (`tests/jobs/cross-tenant-job-leakage.test.ts`, vitest):
     enqueue an export job scoped to Acme with one input pointed at a Globex resource
     ID (via a stubbed test-mode queue), assert the job fails closed or returns zero
     rows for the out-of-scope resource.
3. **Teardown** (`fixtures/teardownTenants.ts`) deletes both tenants and their
   resources so nothing leaks between runs. A tenant that is already gone (404) is
   treated as success, so teardown is safe to run repeatedly.

## How CI wires it

`.github/workflows/cross-tenant-leakage.yml` runs on every `pull_request`. It
installs dependencies and the Playwright browser, **seeds** the two tenants, runs the
**API**, **background-job**, and **UI** leakage suites, then **tears the tenants down
in an `if: always()` step** so a failed test never leaves stale tenants behind.
`BASE_URL`, `ADMIN_API_TOKEN`, and `TENANT_USER_PASSWORD` come from repository secrets.

## Project structure

```
.github/workflows/cross-tenant-leakage.yml   CI: seed -> UI/API/job tests -> teardown (always)
.env.example                                 BASE_URL / ADMIN_API_TOKEN / TENANT_USER_PASSWORD
examples/run-locally.sh                      local seed -> test -> teardown runner
fixtures/shared.ts                           shared config, types, admin fetch, seed-state store
fixtures/seedTenants.ts                      creates Acme + Globex (user + invoice each)
fixtures/teardownTenants.ts                  deletes both tenants and their resources
src/jobs/exportJob.ts                         stubbed tenant-scoped export queue + handler
tests/api/cross-tenant-leakage.api.test.ts   API IDOR leakage (403/404, never 200)
tests/e2e/cross-tenant-leakage.spec.ts       UI direct-URL leakage (access-denied state)
tests/jobs/cross-tenant-job-leakage.test.ts  background-job leakage (fail closed / zero rows)
package.json                                 scripts + dev dependencies
tsconfig.json  vitest.config.ts  playwright.config.ts
```

- `src/` — primary source files for the snippets referenced in the blog post.
- `examples/` — runnable examples you can execute as-is.
- `docs/` — extended notes, diagrams, or supporting material (when present).

## About

This repository is maintained by [Autonoma](https://getautonoma.com) as reference material for the linked blog post. Autonoma builds autonomous AI agents that plan, execute, and maintain end-to-end tests directly from your codebase.

If something here is wrong, out of date, or unclear, please [open an issue](https://github.com/Autonoma-Tools/multi-tenant-saas-testing/issues/new).

## License

Released under the [MIT License](./LICENSE) © 2026 Autonoma Labs.
