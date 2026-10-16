FROM grafana/k6:latest AS k6bin

FROM defradigital/cdp-perf-test-docker:latest

USER root
COPY --from=k6bin /usr/bin/k6 /usr/local/bin/k6

# jq builds the aggregated results/index.html (table + charts) in entrypoint.sh
RUN apk add --no-cache jq

WORKDIR /opt/perftest

COPY scenarios/ ./scenarios/
COPY entrypoint.sh .

RUN chmod +x ./entrypoint.sh

ENV S3_ENDPOINT=https://s3.eu-west-2.amazonaws.com
ENV TEST_SCENARIO=all
ENV CI=true

ENTRYPOINT [ "./entrypoint.sh" ]
