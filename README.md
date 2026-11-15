# Webbase Cloud — App Hosting Platform

<p align="center"><strong>A self-hosted deployment workspace for GitHub and GitLab applications.</strong><br>Deployment Console · Docker Builds · App Containers · Live Logs · Resource Limits · Apache-2.0</p>

<p align="center">
<img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 20+">
<img src="https://img.shields.io/badge/Docker-Engine-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Engine">
<img src="https://img.shields.io/badge/Caddy-Reverse_Proxy-1F88C0?style=for-the-badge&logo=caddy&logoColor=white" alt="Caddy">
<img src="https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge" alt="Apache-2.0">
</p>

## Overview

Webbase Cloud is a self-hosted application deployment control panel. Connect a public GitHub or GitLab repository, build its root-level Dockerfile, and run the resulting container on your own Linux server. Manage deployments, inspect logs, restart or stop apps, and open each app through its assigned public port.

**Webbase Cloud is an independent project. It is not an official Render, Railway, Vercel or Heroku product, and it does not provide compute or free hosting by itself. You must supply and maintain a server or VM.**

## Website

- Hosting dashboard: `/`
- Health endpoint: `/api/health`
- System status (authenticated): `/api/system`

## Features

- Private single-administrator sign-in using bcrypt password hashing and JWT sessions
- Public and private GitHub/GitLab repository deployment using encrypted read-only access tokens
- Docker image builds from a root-level `Dockerfile`
- App lifecycle controls: deploy, redeploy, stop, restart and delete
- Deployment status, Docker health status and per-app build/runtime logs
- Automatic allocation of public host ports from `20000-20100`
- Dashboard links to running applications and custom domains
- Per-app custom domains with Caddy-managed automatic HTTPS
- Per-container defaults of 512 MiB memory, 1 CPU and 256 processes
- Per-app environment variables and private-repository credentials encrypted at rest with AES-256-GCM
- Optional Docker health checks configured per application
- Secret values are write-only in the dashboard; only variable names are listed
- Persistent SQLite metadata and deployment logs
- Caddy reverse proxy in Docker Compose for the dashboard
- Domain-based automatic HTTPS for the dashboard when DNS and ports 80/443 are configured
- Request rate limiting, security headers and bounded JSON request bodies

## Architecture

```text
                         Internet
                            │
                       HTTP / HTTPS
                            │
                            ▼
                     Caddy Reverse Proxy
                            │
                    Private Docker Network
                            │
                            ▼
                    Express Control Panel
                       │            │
                SQLite Metadata   Docker Engine
                       │            │
                       │       Build / Run / Stop
                       │            │
                       │            ▼
                       │       App Containers
                       │            │
                       └──── Host Ports 20000-20100
                                    │
                                    ▼
                              Public App URLs
```

## Requirements

- Ubuntu 22.04 or 24.04 recommended
- Docker Engine
- Docker Compose plugin
- Public IPv4 address or a domain pointed to the server
- TCP ports 80 and 443 open for the dashboard proxy
- TCP ports 20000-20100 open for deployed applications
- A server with enough CPU, memory and disk for the panel and your app containers

## Run with Docker Compose

1. Clone the repository:

   ```bash
   git clone https://github.com/xsoftwareabdullah1-create/Webbase-Cloud.git
   cd Webbase-Cloud
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

3. Edit `.env`. Set a unique random JWT secret, a strong administrator password, and your server's public IP or hostname.

4. Start Webbase Cloud:

   ```bash
   docker compose up -d --build
   ```

5. Open `http://YOUR_SERVER_IP` and sign in with the administrator credentials from `.env`.

6. Confirm Docker is online in the dashboard's system status before creating a deployment.

The panel is connected to the Docker socket so it can build and manage app containers. The panel's internal port is served through Caddy on the Compose network. Do not expose the Docker socket or dashboard to untrusted users.

## Domain and HTTPS

For a domain, point its DNS A/AAAA record to your server. Edit the site address in `Caddyfile` from `:80` to your domain, for example:

```caddy
cloud.example.com {
  encode zstd gzip
  reverse_proxy panel:8080
}
```

Then restart the proxy:

```bash
docker compose restart proxy
```

Caddy can automatically obtain and renew a TLS certificate when the domain resolves to the server and inbound TCP ports 80 and 443 are reachable. The same Caddy instance also routes configured app domains to their containers and obtains HTTPS certificates automatically. For an app domain, add an A/AAAA record pointing to this server, then set the domain in that app's dashboard settings. Ports 80 and 443 must be reachable. Direct allocated host-port URLs remain HTTP. The panel container must have the Caddyfile mounted at `/app/Caddyfile` (the supplied Compose file already does this). Webbase Cloud writes managed app-domain site blocks into that file and asks Caddy to reload its configuration.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `8080` | Internal dashboard HTTP port |
| `JWT_SECRET` | Yes | — | Random signing secret; minimum 32 characters |
| `ADMIN_EMAIL` | No | `admin@example.com` | Initial administrator email |
| `ADMIN_PASSWORD` | Yes | — | Initial administrator password; minimum 12 characters |
| `DATA_DIR` | No | `./data` | SQLite database and app checkout directory |
| `DOCKER_NETWORK` | No | `webbase-cloud` | Docker network used by deployed containers |
| `PUBLIC_HOST` | Recommended | `localhost` | Public server IP or hostname used in app URLs |
| `PUBLIC_DOMAIN` | No | — | Alternative public hostname setting |
| `PUBLIC_SCHEME` | No | `http` | Scheme used for generated app URLs |
| `APP_PORT_START` | No | `20000` | First host port in the allocation range |
| `APP_PORT_END` | No | `20100` | Last host port in the allocation range |
| `APP_MEMORY_LIMIT` | No | `512m` | Per-app container memory limit |
| `APP_CPU_LIMIT` | No | `1` | Per-app container CPU limit |
| `CADDYFILE_PATH` | No | `./Caddyfile` | Caddy config file mounted into the panel container |
| `CADDY_CONTAINER` | No | `webbase-cloud-proxy` | Caddy container name used for config reloads |
| `APP_ENCRYPTION_KEY` | Required for env vars | — | 32-byte encryption key as 64 hex characters or base64; keep stable and back it up securely |

Generate a secret rather than using the example placeholder:

```bash
openssl rand -hex 32
# Use the output as APP_ENCRYPTION_KEY
```

Never commit `.env`, credentials, API keys or other secrets to Git. Keep `APP_ENCRYPTION_KEY` backed up and unchanged: losing or rotating it without decrypting/re-encrypting existing records makes saved app variables unreadable. The key protects values at rest, but the Docker host administrator can still access running container environments.

## API

Protected endpoints require the header `Authorization: Bearer YOUR_TOKEN`. Obtain a token from the login endpoint.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Sign in as administrator |
| GET | `/api/me` | Get the signed-in administrator |
| GET | `/api/system` | Check Docker and host configuration |
| GET | `/api/apps` | List applications and their deployment status |
| POST | `/api/apps` | Register and queue a new deployment |
| GET | `/api/apps/:id/logs` | Read recent deployment logs |
| GET | `/api/apps/:id/env` | List saved environment variable names (not values) |
| GET/PUT/DELETE | `/api/apps/:id/repository-auth` | Check, set or remove an encrypted Git token |
| PUT | `/api/apps/:id/domain` | Set or remove the app's custom domain and reload Caddy |
| PUT | `/api/apps/:id/env` | Add/update variables; send `null` to delete a key |
| POST | `/api/apps/:id/action` | Deploy, stop or restart an application |
| DELETE | `/api/apps/:id` | Remove an application |
| GET | `/api/health` | Public service health check |

Create-app request example:

```json
{
  "name": "My Website",
  "repo": "https://github.com/owner/repository",
  "branch": "main",
  "port": 3000
}
```

The repository must contain a `Dockerfile` in its root directory. Public repositories need no token. For private repositories, provide a GitHub fine-grained token with read-only Contents access or a GitLab deploy token with read_repository scope. Tokens are encrypted at rest and are not returned by the API. Set `APP_ENCRYPTION_KEY` before saving credentials. The app must listen on the configured container port and bind to `0.0.0.0`, not only `127.0.0.1`. You can provide an optional health-check command at deployment time; it is passed to Docker with a 30-second interval, 5-second timeout, 3 retries and a 20-second start period. The command must exist inside the app image. Docker reports `healthy`, `unhealthy` or `starting`; apps without a configured command show `none`.

## Deployment behavior

When a deployment is queued, Webbase Cloud clones the selected branch, builds the Docker image, replaces the previous app container, and starts the new container with resource limits. The dashboard records the deployment state and logs.

Each running app receives an available host port from the configured range. Its URL has this form:

```text
http://YOUR_SERVER_IP:20000
```

The actual port is allocated automatically. Ensure the host firewall and cloud-provider network rules permit the configured range.

## Current limitations

This is an early, single-server MVP. It now supports private Git cloning, per-app custom domains with Caddy-managed HTTPS, optional Docker health checks and health-gated replacement deployments. It does not yet provide build-time secrets, wildcard domains, a multi-server scheduler/agent, billing, managed databases or automated backups. Runtime environment variables and repository tokens are encrypted at rest, but the Docker host administrator can access running container environments and build contexts. Secret values are write-only through the dashboard and API. App containers have basic resource limits, not production-grade isolation.

## Security and cost

- Keep the dashboard private and restrict access with a firewall or VPN.
- The Docker socket is highly privileged and effectively grants root-level control of the host.
- Dockerfiles from deployed repositories execute build instructions on your server. Deploy only code you trust.
- Use narrowly scoped read-only repository tokens. They are encrypted at rest, but the server administrator controls the runtime and can access credentials during cloning.
- Use a strong administrator password and a unique `JWT_SECRET`.
- Back up the `data/` directory and your server separately.
- Hosting costs depend on the server provider and its limits. Webbase Cloud itself does not create an always-free VM or guarantee free 24/7 compute.

Do not use this MVP as an untrusted public multi-tenant hosting service.

## Project structure

```text
Webbase-Cloud/
├── public/
│   └── index.html
├── data/                    # Runtime database and app checkouts
├── .github/
│   └── workflows/
│       └── ci.yml
├── server.js                # Express API and deployment controller
├── Dockerfile               # Panel container image
├── docker-compose.yml       # Panel, Caddy and shared network
├── Caddyfile                # Dashboard reverse proxy
├── package.json
├── .env.example
├── .gitignore
└── LICENSE
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).

<p align="center">Built and maintained by <strong>Abdullah</strong><br><sub>Copyright © 2026 Abdullah. Licensed under Apache-2.0.</sub></p>
