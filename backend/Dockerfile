# Build stage
FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /app
COPY backend/pom.xml pom.xml
COPY backend/checkstyle.xml checkstyle.xml
COPY backend/common/pom.xml common/pom.xml
COPY backend/identity/pom.xml identity/pom.xml
# Issue #291: the shared protobuf contract lives outside the Maven module tree.
COPY contracts/proto contracts/proto
# Maven Central answers HTTP 429 to bursts of requests from shared CI egress IPs.
# A cold cache (for example right after the repository changed owner) downloads
# everything at once, so retry with backoff instead of failing the required
# Docker Build check on a transient rate limit.
RUN set -eu; \
    attempt=1; \
    until mvn -B -q -DskipTests dependency:go-offline; do \
      if [ "$attempt" -ge 5 ]; then \
        echo "dependency:go-offline failed after $attempt attempts" >&2; \
        exit 1; \
      fi; \
      attempt=$((attempt + 1)); \
      sleep $((attempt * 10)); \
    done
COPY backend/common/src common/src
COPY backend/identity/src identity/src
RUN set -eu; \
    attempt=1; \
    until mvn -B -q -DskipTests -Dproto.root=/app/contracts/proto package; do \
      if [ "$attempt" -ge 5 ]; then \
        echo "package failed after $attempt attempts" >&2; \
        exit 1; \
      fi; \
      attempt=$((attempt + 1)); \
      sleep $((attempt * 10)); \
    done

# Runtime stage
FROM eclipse-temurin:25-jre
WORKDIR /app
# The image intentionally installs nothing from the Ubuntu archive: a runner-side DNS outage
# previously blocked every Compose build. The healthcheck uses bash's /dev/tcp instead of curl.
COPY --from=build /app/identity/target/awap-identity-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
