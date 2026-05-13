---
slug: /operators/deployment
sidebar_position: 2
---

# Deployment

Airnode is a single long-lived process. Deployment means keeping it running reliably with automatic restarts and secure
key management.

## Prerequisites

- The `airnode` binary on your `PATH` (or a known install path)
- A validated `config.yaml`
- A `.env` file with `AIRNODE_MNEMONIC` (or `AIRNODE_PRIVATE_KEY`)

## Direct

```bash
airnode start -c config.yaml
```

## systemd

Create a service file for automatic restarts and boot persistence:

```ini
# /etc/systemd/system/airnode.service
[Unit]
Description=Airnode
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=airnode
WorkingDirectory=/opt/airnode
ExecStart=/usr/local/bin/airnode start -c /opt/airnode/config.yaml
Restart=always
RestartSec=10
EnvironmentFile=/opt/airnode/.env

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/airnode

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable airnode
sudo systemctl start airnode
```

View logs:

```bash
journalctl -u airnode -f
```

For JSON log aggregation, set `LOG_FORMAT=json` in the `.env` file.

## Docker

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["bun", "src/cli/index.ts", "start"]
```

Build and run:

```bash
docker build -t airnode .
docker run -d --name airnode --restart unless-stopped \
  -p 3000:3000 \
  -v $(pwd)/config.yaml:/app/config.yaml:ro \
  -e AIRNODE_PRIVATE_KEY=0x... \
  airnode
```

Pass secrets via environment variables or Docker secrets. Do not bake them into the image.

## Docker Compose

```yaml
# compose.yaml
services:
  airnode:
    build: .
    restart: unless-stopped
    ports:
      - '3000:3000'
    env_file: .env
    volumes:
      - ./config.yaml:/app/config.yaml:ro
```

```bash
docker compose up -d
```

## Environment variables

| Variable              | Required | Description                                                                        |
| --------------------- | -------- | ---------------------------------------------------------------------------------- |
| `AIRNODE_MNEMONIC`    | Yes\*    | BIP-39 mnemonic. Signs all responses. Takes precedence over `AIRNODE_PRIVATE_KEY`. |
| `AIRNODE_PRIVATE_KEY` | Yes\*    | Hex-encoded private key (with `0x` prefix). Signs all responses.                   |
| `LOG_FORMAT`          | No       | `text` (default) or `json`.                                                        |
| `LOG_LEVEL`           | No       | `debug`, `info` (default), `warn`, or `error`.                                     |

\* Exactly one of `AIRNODE_MNEMONIC` or `AIRNODE_PRIVATE_KEY` is required. Any `${VAR}` referenced in your config must
also be set in the environment.

## Graceful shutdown

Airnode handles `SIGINT` and `SIGTERM` for clean shutdown. The server stops accepting new requests, in-flight requests
complete, the cache is cleared, and the process exits.

```bash
# Manual stop
kill -TERM $(pgrep -f "airnode start")

# systemd
sudo systemctl stop airnode

# Docker
docker stop airnode
```

## Key management

The `AIRNODE_PRIVATE_KEY` controls the airnode's on-chain identity and signs all responses. Protect it accordingly:

- **Never commit** the private key to version control. Use `.env` files (gitignored) or secret managers.
- **Restrict file permissions**: `chmod 600 .env` so only the airnode user can read it.
- **Use secret managers in cloud environments**: AWS Secrets Manager, GCP Secret Manager, or HashiCorp Vault.
- **Separate keys per environment**: use different private keys for testnet and mainnet.
- **Back up the key securely**: if lost, the airnode address changes and all on-chain associations must be
  re-established.

## Health checks

The `/health` endpoint returns the node's status and airnode address:

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "airnode": "0x..."
}
```

Use this for Docker `HEALTHCHECK`, load balancer probes, or uptime monitoring. (To check the binary version, run
`airnode --version` — the version is deliberately not exposed on `/health`.)
