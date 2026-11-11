# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A k6-based performance test suite for the DEFRA CDP Platform, migrated from JMeter (EB-219). There is no application code: the repo is a set of k6 scripts plus a Docker wrapper that runs them and publishes results to S3 for the CDP Portal. The image is based on `defradigital/cdp-perf-test-docker` (provides the `aws` CLI) with the k6 binary copied in.

## Architecture

- `scenarios/backend/tests/<area>/<test>.js` — k6 scripts for `registration` and `obligations`, each with `baseline.js`, `scenario-a-load.js`, `scenario-b-stress.js`, `spike.js`, `capacity.js`, `soak.js` (all hit `GET /health` for now).
- `scenarios/backend/tests/submissions/create-pom-submissions/<test>.js` — the same six scripts for the submissions backend. Each iteration runs `POST /pom-submissions`, two `GET`s, a `PATCH` (amend) and a final `GET` through `lib/pom-submissions-flow.js`. `setup()` signs in stub users and shares their tokens with the VUs. Requests are tagged by name (`POST`/`PATCH`/`GET /pom-submissions`, all GETs combined) so the report shows durations per endpoint.
- `scenarios/backend/lib/auth.js` — signs in to the Defra ID stub (`DEFRA_ID_STUB_URL`, default `cdp-defra-id-stub.${ENVIRONMENT}.cdp-int.defra.cloud`) and returns bearer tokens. `getAccessTokens(n)` uses `batteries-journey-autotests<1..n>@example.com`, registering any user the stub doesn't have.
- `scenarios/backend/lib/load-model.js` — executor options and thresholds. `WRITE_VU_OVERRIDES.<scenario>.preAllocatedVUs` is also how many stub users each submissions test signs in; VUs beyond that share a token. `READ_DURATION_OVERRIDES` and `READ_CAPACITY` (shorter runs) are for the read-only `registration` and `obligations` tests, not the submissions write flow.
- `scenarios/backend/lib/config.js` — `baseUrl()` and `httpParams`. `<AREA>_BASE_URL` (`REGISTRATION_BASE_URL`, `SUBMISSIONS_BASE_URL`, `OBLIGATIONS_BASE_URL`) overrides the per-service default `https://<service>.${ENVIRONMENT}.cdp-int.defra.cloud`; with `CDP_API_KEY` set it goes via the ephemeral gateway instead.
- `entrypoint.sh` — container entrypoint. Requires `ENVIRONMENT`. What runs is chosen by `TEST_SCENARIO`, or by `PROFILE` when `TEST_SCENARIO` is unset (the CDP Portal only offers a profile): every script under `scenarios/backend/tests` (`all`, default), a folder under `tests/` (`TEST_SCENARIO=submissions` — baseline gate first, then the rest, no soak), `TEST_SCENARIO=baselines`, or a single one (`TEST_SCENARIO=<area>/<file>.js`, e.g. `submissions/create-pom-submissions/baseline.js`) with `k6 run --summary-export`, writes `results/<path-under-tests>/<test>/summary.json`, then copies `results/` to `RESULTS_OUTPUT_S3_PATH` via `S3_ENDPOINT`. Exits 1 if `RESULTS_OUTPUT_S3_PATH` is unset or any script fails.
- `compose.yml` + `compose/` — local stack: the test container, LocalStack (S3 bucket `test-results` created by `compose/localstack/*.sh`), Redis, and the service under test (must expose `/health` on port 3000). Results are mounted to `./results`.
- `.github/workflows/publish.yml` — on push to `main`, builds and publishes the Docker image used by the CDP Portal. There is no separate lint or test step.
- `.github/workflows/publish-hotfix.yml` — manual (`workflow_dispatch`), the standard CDP hotfix workflow: builds a branch (no PR) and publishes a prerelease image `x.y.z-<branch-name>.N` so it can be tried from the CDP Portal. Run it from the Actions tab (**Publish Hot Fix**) and pick the branch; the file must exist on `main` and on that branch. Append-only: no amend/rebase/force-push after the first tag.

## Commands

```bash
# Run a single test locally (requires k6)
ENVIRONMENT=dev k6 run scenarios/backend/tests/submissions/create-pom-submissions/baseline.js

# Submissions baseline from a laptop: CDP_API_KEY routes calls via the ephemeral gateway
# (leave it unset in CDP). k6 does not create the results folder, so make it first.
mkdir -p results/submissions/create-pom-submissions/baseline
CDP_API_KEY=<key> ENVIRONMENT=perf-test k6 run scenarios/backend/tests/submissions/create-pom-submissions/baseline.js

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

- **Layout**: k6 code lives under `scenarios/backend/`. Shared helpers go in `scenarios/backend/lib/`; tests go in `scenarios/backend/tests/<area>/[<feature>/]<test>.js`.
- **Scenario types** (reference repo naming): `baseline.js` (smoke gate; submissions: `VUS` env, default 1, one iteration per VU, with think time), `scenario-a-load.js`, `scenario-b-stress.js`, `spike.js`, `capacity.js`, `soak.js` (local-only, refused under `CI=true`). Load tests use the open model (`constant-arrival-rate`), not closed VU loops.
- **Config via env**: `ENVIRONMENT` is required. Do not hardcode hosts in tests; import from `lib/config.js`.
- **Assertions**: every test sets `thresholds` (at minimum `checks: ['rate==1.0']` for baselines, p(95) latency for load tests) and uses `check()` on status and response shape.
- **Results**: `handleSummary` (via `lib/summary.js`) writes HTML, JSON and JUnit to `results/<path-under-tests>/<test>` (overridable via `RESULTS_DIR`); `entrypoint.sh` builds an aggregated `results/index.html` and uploads results + logs to S3.
- **Run gating**: `entrypoint.sh` runs all baselines first and aborts before load tests if any fails; `soak.js` is excluded from `all` and refused under `CI=true`.
