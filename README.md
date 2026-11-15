# Webbase Cloud

A self-hosted, single-server deployment control panel. This is a separate project from Webbase Database.

## MVP features
- Private administrator login (JWT + bcrypt)
- Register public GitHub/GitLab repositories containing a root-level `Dockerfile`
- Build and run app containers with Docker
- View deployment logs; stop, restart, redeploy and delete apps
- Automatically allocate a host port and show the resulting app URL
- Per-app default limits: 512 MiB RAM, 1 CPU and 256 processes
- Persistent SQLite metadata and deployment logs

## Requirements
- Ubuntu 22.04/24.04 server
- Node.js 20+, npm, Git and Docker Engine
- Public IPv4 address
- Open TCP ports 8080 (dashboard) and 20000-20100 (deployed apps), restricted to the intended audience where possible

## Setup
1. Clone this repository onto your Linux server.
2. Copy `.env.example` to `.env`.
3. Set a random `JWT_SECRET` (32+ characters), a strong `ADMIN_EMAIL` and `ADMIN_PASSWORD` (12+ characters), and `PUBLIC_HOST` to the server's public IP or hostname.
4. Install dependencies: `npm install`.
5. Ensure Docker is installed, running, and the server process can access its Docker socket.
6. Start: `npm start` (or use Docker Compose).
7. Open `http://PUBLIC_HOST:8080` and sign in with the admin credentials from `.env`.

## Deployment URL behavior
Each app container is published on an available TCP port in the host range `20000-20100`. The dashboard displays `http://PUBLIC_HOST:PORT` for each running app. The server's firewall and cloud network security rules must allow the selected port range. The app must listen on the container port configured during deployment and bind to `0.0.0.0`, not only `127.0.0.1`.

This MVP does **not** yet provide automatic HTTPS, custom domains, wildcard subdomains, private Git repositories, build secrets, automatic health checks, multi-server scheduling, billing, managed databases, or automated backups. Do not enter secrets into public repositories.

## Security and cost notes
This software does not provide free compute or hosting by itself. You must supply a server/VM. The Docker socket is highly privileged (effectively root access), and repository Dockerfiles execute build steps on your server. Keep this dashboard private, use only repositories you trust, use a firewall or VPN, and do not expose it as an untrusted multi-user service. App containers have basic CPU, memory and process limits, but this is not production-grade isolation. Always Free capacity and availability depend on the provider and are not guaranteed.

## License
Apache-2.0.
