# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A k6-based performance test suite for the DEFRA CDP Platform, migrated from JMeter (EB-219). There is no application code: the repo is a set of k6 scripts plus a Docker wrapper that runs them and publishes results to S3 for the CDP Portal. The image is based on `defradigital/cdp-perf-test-docker` (provides the `aws` CLI) with the k6 binary copied in.

## Architecture

- `scenarios/backend/tests/<area>/<test>.js` — k6 scripts. Areas: `registration`, `submissions`, `obligations`, each currently with `health.js` (`GET /health`).
- `scenarios/backend/lib/config.js` — `baseUrl()` and `httpParams`. `EPR_BACKEND_BASE_URL` overrides the default `https://service-name.${ENVIRONMENT}.cdp-int.defra.cloud`; the `service-name` placeholder must be replaced with the real service (and in `compose.yml`'s `image:`).
- `entrypoint.sh` — container entrypoint. Requires `ENVIRONMENT`. Runs every script under `scenarios/backend/tests` (`TEST_SCENARIO=all`, default) or a single one (`TEST_SCENARIO=<area>/<file>.js`) with `k6 run --summary-export`, writes `results/<area>/<test>/summary.json`, then copies `results/` to `RESULTS_OUTPUT_S3_PATH` via `S3_ENDPOINT`. Exits 1 if `RESULTS_OUTPUT_S3_PATH` is unset or any script fails.
- `compose.yml` + `compose/` — local stack: the test container, LocalStack (S3 bucket `test-results` created by `compose/localstack/*.sh`), Redis, and the service under test (must expose `/health` on port 3000). Results are mounted to `./results`.
- `.github/workflows/publish.yml` — on push to `main`, builds and publishes the Docker image used by the CDP Portal. There is no separate lint or test step.

## Commands

```bash
# Run a single test locally (requires k6)
ENVIRONMENT=dev k6 run scenarios/backend/tests/registration/health.js

# Build image
docker build . -t my-performance-tests

# Full local stack (LocalStack, Redis, service, tests)
docker compose up --build

# Run the image directly against a LocalStack bucket
docker run \
  -e S3_ENDPOINT='http://host.docker.internal:4566' \
  -e RESULTS_OUTPUT_S3_PATH='s3://my-bucket' \
  -e AWS_ACCESS_KEY_ID=test -e AWS_SECRET_ACCESS_KEY=test -e AWS_REGION=eu-west-2 \
  -e ENVIRONMENT=perf-test \
  my-performance-tests
```

`entrypoint.sh` and `scenarios/` are baked into the image (see `Dockerfile`), so rebuild after any change.

## k6 migration standards

The reference implementation is the sibling repo `waste-obligations-perf-tests` (`scenarios/backend/`); follow its conventions. All JMeter artefacts (`.jmx`, `user.properties`, `jmeter` invocations) have been removed.

- **Layout**: k6 code lives under `scenarios/backend/`. Shared helpers go in `scenarios/backend/lib/`; tests go in `scenarios/backend/tests/<area>/<test>.js`.
- **Scenario types** (reference repo naming): `baseline.js` (1 VU, 1 iteration, smoke gate), `scenario-a-load.js`, `scenario-b-stress.js`, `spike.js`, `capacity.js`, `soak.js` (local-only, refused under `CI=true`). Load tests use the open model (`constant-arrival-rate`), not closed VU loops.
- **Config via env**: `ENVIRONMENT` is required. Do not hardcode hosts in tests; import from `lib/config.js`.
- **Assertions**: every test sets `thresholds` (at minimum `checks: ['rate==1.0']` for baselines, p(95) latency for load tests) and uses `check()` on status and response shape.
- **Results**: the reference writes HTML, JSON and JUnit via `handleSummary` to `results/<area>/<test>` (overridable via `RESULTS_DIR`). Here only `summary.json` via `--summary-export` is produced so far; summary/report libs are not yet ported.
- **Run gating**: the reference runs all baselines first and aborts before load tests if any fails. Not yet implemented in `entrypoint.sh`.
