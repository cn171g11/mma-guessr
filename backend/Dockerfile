# MmaGuessr backend - Go single-binary image (pure stdlib + modernc sqlite, no CGO)
FROM golang:1.26-alpine AS build

WORKDIR /src

# Cache module downloads first for faster incremental builds.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/mma-guessr ./cmd/server

FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY --from=build /out/mma-guessr /app/mma-guessr

# Runtime data lives on a volume so the SQLite database survives restarts.
VOLUME ["/app/data"]
ENV SQLITE_PATH=/app/data/mma_guessr.db \
    PORT=3000 \
    NODE_ENV=production

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/app/mma-guessr"]
