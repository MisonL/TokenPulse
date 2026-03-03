FROM golang:1.24-alpine AS builder
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/claude-utls-bridge-go ./cmd/bridge

FROM alpine:3.21
WORKDIR /app
COPY --from=builder /out/claude-utls-bridge-go /usr/local/bin/claude-utls-bridge-go
EXPOSE 9460
ENTRYPOINT ["/usr/local/bin/claude-utls-bridge-go"]
