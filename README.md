# Webbase Cloud

A self-hosted, single-server deployment control panel. This is a separate project from Webbase Database.

## MVP scope
- Responsive admin dashboard
- Private administrator login
- Register public GitHub/GitLab repositories that contain a root `Dockerfile`
- Build and run app containers with Docker
- View deployment logs; stop, restart, redeploy and delete apps

## Requirements
- Ubuntu 22.04/24.04 server
- Node.js 20+, npm, Git and Docker Engine + Compose plugin
- Public IP; a domain is recommended for HTTPS

## Setup
1. Clone this repository onto your own Linux server.
2. Copy `.env.example` to `.env` and set a unique `JWT_SECRET` (32+ chars), `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (12+ chars).
3. Install dependencies with `npm install`.
4. Start with `npm start` (or use the included Docker Compose setup).
5. Restrict access to the dashboard with a firewall or VPN.

## Important security and cost notes
This software does not provide free compute or hosting by itself. You must supply a server/VM. The Docker socket is highly privileged (effectively root access); do not expose an untrusted multi-user service. This MVP is for a single trusted administrator, not public multi-tenant hosting. Always Free capacity and availability depend on the provider and are not guaranteed.

## Limitations
Public repositories only; each app needs a Dockerfile. Private repository credentials, build secrets, multi-server scheduling, billing, teams, managed databases, automatic backups, and production-grade isolation are not implemented yet.

## License
Apache-2.0.
