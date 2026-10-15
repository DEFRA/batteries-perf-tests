#!/bin/sh

if [ -f "./env.sh" ]; then
  . ./env.sh
fi

if [ -z "$ENVIRONMENT" ]; then
  echo "Error: ENVIRONMENT is not set" >&2
  exit 1
fi
echo "run_id: $RUN_ID in $ENVIRONMENT"
export ENVIRONMENT

REPO_LOCATION=$(cd "$(dirname "$0")" && pwd)
K6_TESTS=${REPO_LOCATION}/scenarios/backend/tests
K6_RESULTS=${REPO_LOCATION}/results

TEST_SCENARIO=${TEST_SCENARIO:-all}

rm -rf "$K6_RESULTS"
mkdir -p "$K6_RESULTS"

if [ "$TEST_SCENARIO" = "all" ]; then
  scripts=$(find "$K6_TESTS" -name "*.js" -type f | sort)
else
  scripts="${K6_TESTS}/${TEST_SCENARIO}"
  if [ ! -f "$scripts" ]; then
    echo "Scenario not found: $scripts" >&2
    exit 1
  fi
fi

if [ -z "$scripts" ]; then
  echo "No k6 scripts found in $K6_TESTS" >&2
  exit 1
fi

test_exit_code=0
for script in $scripts; do
  name=${script#"$K6_TESTS"/}
  name=${name%.js}
  out="$K6_RESULTS/$name"
  mkdir -p "$out"
  echo "Running $name"
  k6 run --summary-export "$out/summary.json" "$script" || test_exit_code=1
done

# Publish the results into S3 so they can be displayed in the CDP Portal
if [ -n "$RESULTS_OUTPUT_S3_PATH" ]; then
  aws ${S3_ENDPOINT:+--endpoint-url=$S3_ENDPOINT} s3 cp "$K6_RESULTS" "$RESULTS_OUTPUT_S3_PATH" --recursive \
    && echo "Test results published to $RESULTS_OUTPUT_S3_PATH"
else
  echo "RESULTS_OUTPUT_S3_PATH is not set"
  exit 1
fi

exit $test_exit_code
