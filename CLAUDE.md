# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A JMeter-based performance test suite for the DEFRA CDP Platform, built from the CDP perf-test template. There is no application code: the repo is a JMeter scenario plus a Docker wrapper that runs it and publishes results to S3 for the CDP Portal. The image is based on `defradigital/cdp-perf-test-docker`, which provides `jmeter` and the `aws` CLI.

## Architecture

- `scenarios/*.jmx` — JMeter test plans (XML). `entrypoint.sh` selects one via `TEST_SCENARIO` (default `test`, i.e. `scenarios/test.jmx`). Add new scenarios as `<name>.jmx` and set `TEST_SCENARIO=<name>`.
- `entrypoint.sh` — container entrypoint. Runs `jmeter -n` headless, passing `-Jenv`, `-Jdomain`, `-Jport`, `-Jprotocol` from env vars (`ENVIRONMENT`, `SERVICE_ENDPOINT`, `SERVICE_PORT`, `SERVICE_URL_SCHEME`), generates the HTML report, then copies the CSV and report to `RESULTS_OUTPUT_S3_PATH` via `S3_ENDPOINT`. It exits 1 if `RESULTS_OUTPUT_S3_PATH` is unset or no `index.html` report was produced.
- The JMX reads those values with `${__P(domain, ...)}`, `${__P(protocol, ...)}`, `${__P(port, ...)}`. Keep the `-J` property names in `entrypoint.sh` and the `__P` names in the JMX in sync.
- `SERVICE_ENDPOINT` defaults to the placeholder `service-name.${ENVIRONMENT}.cdp-int.defra.cloud` in both `entrypoint.sh` and `test.jmx`; the `service-name` placeholder must be replaced with the real target service in both places (and in `compose.yml`'s `image:`).
- `compose.yml` + `compose/` — local stack: the test container, LocalStack (S3 bucket `test-results` created by `compose/localstack/*.sh`), Redis, and the service under test (must expose `/health` on port 3000). Reports are mounted to `./reports`.
- `.github/workflows/publish.yml` — on push to `main`, builds and publishes the Docker image used by the CDP Portal. There is no separate lint or test step.

## Commands

```bash
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

Change which scenario runs with `-e TEST_SCENARIO=<name>`. `entrypoint.sh` and `scenarios/` are baked into the image (see `Dockerfile`), so rebuild after any change. `user.properties` is copied into the image as well.
