#!/usr/bin/env bash
#
# End-to-end local run of the two-tenant isolation suite:
#   seed -> UI + API + background-job leakage tests -> teardown (always).
#
# Requirements:
#   - Node 20+
#   - A running instance of the app under test reachable at $BASE_URL
#   - ADMIN_API_TOKEN exported (see .env.example)
#
# The teardown step runs on EXIT (even on failure) so tenants never leak.

set -euo pipefail

# Run from the repository root regardless of where this script is invoked.
cd "$(dirname "$0")/.."

: "${BASE_URL:=http://localhost:3000}"
export BASE_URL

if [[ -z "${ADMIN_API_TOKEN:-}" ]]; then
  echo "ADMIN_API_TOKEN is not set. Copy .env.example to .env, set it, and export it." >&2
  exit 1
fi

teardown() {
  echo "==> Tearing down seeded tenants"
  npm run teardown || true
}
trap teardown EXIT

echo "==> Installing dependencies"
npm install
npx playwright install chromium

echo "==> Seeding two isolated tenants (Acme + Globex)"
npm run seed

echo "==> Background-job leakage (self-contained)"
npm run test:jobs

echo "==> API leakage (cross-tenant reads must be 403/404)"
npm run test:api

echo "==> UI leakage (Tenant A cannot open Tenant B's invoice)"
npm run test:e2e

echo "==> All leakage suites passed"
