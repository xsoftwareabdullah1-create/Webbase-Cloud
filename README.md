# Webbase Cloud

<p align="center"><strong>A Git-based site deployment dashboard built for Cloudflare Pages.</strong><br>Pages API · Pages Functions · D1 Database · GitHub / GitLab · Apache-2.0</p>

## Live dashboard

- Production site: https://webbase-cloud.pages.dev
- API health: https://webbase-cloud.pages.dev/api/health

## Cloudflare deployment mode

The Cloudflare version uses:
- **Cloudflare Pages** for the dashboard and deployed static sites
- **Pages Functions** for the authenticated API
- **D1** for application metadata and audit logs
- **Cloudflare Pages API** to create, redeploy, inspect and delete connected Pages projects

This mode does not need a VPS, Docker daemon, SSH server, or always-on phone. It is designed for static sites and applications supported by Cloudflare Pages. It does **not** run arbitrary Dockerfiles, long-running containers, or general-purpose server processes.

## One-time setup

The Git-connected Pages project must use the repository root as its root directory and `public` as its build output directory. Leave the build command empty for this dashboard.

### 1. Connect D1

1. Open Cloudflare Dashboard → **Workers & Pages** → **D1**.
2. Create a database named `webbase-cloud-db`.
3. Open the `webbase-cloud` Pages project → **Settings → Bindings**.
4. Add a **D1 database binding** with variable name exactly `DB` and select the database.
5. Save and redeploy the Pages project.

The API creates its tables on the first request. The equivalent SQL schema is also in `migrations/0001_initial.sql`.

### 2. Add Pages environment variables

Open the Pages project → **Settings → Variables and Secrets**. Add these for the **Production** environment:

| Variable | Type | Requirement |
| --- | --- | --- |
| `ADMIN_EMAIL` | Plain text or secret | Required |
| `ADMIN_PASSWORD` | Secret | Required; at least 12 characters |
| `JWT_SECRET` | Secret | Required; random value of at least 32 characters |
| `CLOUDFLARE_ACCOUNT_ID` | Plain text | Required |
| `CLOUDFLARE_API_TOKEN` | Secret | Required; token with Cloudflare Pages **Write** permission for this account |

Use a unique password and random JWT secret. Do not put secrets in GitHub files, commit messages, screenshots, or chat. After adding or changing bindings/secrets, trigger a new Pages deployment so Functions receive them.

### 3. Authorize Git repositories

In Cloudflare Pages, connect the GitHub or GitLab account and authorize the repositories you want Webbase Cloud to deploy. The API can only create Pages projects for repositories already authorized in that Cloudflare account.

### 4. Sign in

Open https://webbase-cloud.pages.dev and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Create a site

In **New site**, provide:
- A site name
- A public GitHub or GitLab HTTPS repository URL
- Production branch (usually `main`)
- Build command (leave blank for plain HTML)
- Build output directory (for example `public`, `dist`, or `build`)

The repository is connected to Cloudflare Pages using the Cloudflare Pages API. Cloudflare performs the build and hosts the result. Git provider authorization is managed by Cloudflare; private repository access is not handled by storing personal access tokens in this app.

## Dashboard capabilities

- Single-admin login with signed 12-hour sessions
- D1-backed application registry and activity logs
- Create Cloudflare Pages projects from authorized GitHub/GitLab repositories
- Trigger redeployments for the configured branch
- Read deployment status and deployment logs through the Cloudflare API
- Add custom domains to Pages projects
- Delete managed Pages projects
- Basic login attempt throttling

## API

All protected endpoints use `Authorization: Bearer <token>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Check Pages Functions, D1 binding and Pages API configuration |
| POST | `/api/auth/login` | Admin sign-in |
| GET | `/api/me` | Current admin |
| GET | `/api/system` | Cloudflare platform status |
| GET/POST | `/api/apps` | List or create Pages projects |
| POST | `/api/apps/:id/action` | Redeploy a site |
| GET | `/api/apps/:id/logs` | Activity and Cloudflare deployment logs |
| PUT | `/api/apps/:id/domain` | Add a custom domain |
| DELETE | `/api/apps/:id` | Delete a managed Pages project |

## Local development

Cloudflare Pages Functions require the Cloudflare runtime. Use Wrangler with a local D1 database:

```bash
npm install
npx wrangler pages dev public --d1 DB=<LOCAL_D1_DATABASE_ID>
```

For production, configure the D1 binding and secrets in the Cloudflare Pages dashboard. Never use production credentials in local development.

## Legacy Docker deployment

The repository still contains the original Docker Compose deployment for users who operate their own Linux VPS. `Dockerfile`, `docker-compose.yml`, `server.js`, and `Caddyfile` belong to that legacy self-hosted mode. They are **not** used by the Cloudflare Pages deployment. The Pages version does not expose Docker management endpoints.

## Security

- Keep `CLOUDFLARE_API_TOKEN` secret and grant only the Pages Write permission needed by this app.
- Use a strong admin password and a unique random `JWT_SECRET`.
- The dashboard is a single-admin control panel, not a public multi-tenant service.
- Anyone who can use the admin dashboard can create and delete Pages projects within the scope of the configured API token.
- Keep the Cloudflare account protected with MFA and review API token permissions regularly.
- Do not expose tokens or passwords in screenshots or chat.

## Cost

Webbase Cloud does not itself charge for hosting. This deployment uses Cloudflare services and remains subject to the limits and terms of the Cloudflare plan on the account. Keep usage within the Free plan limits and do not enable paid add-ons or upgrade plans if the requirement is zero payment. Cloudflare may change plan limits; this project cannot guarantee unlimited or lifetime free compute.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
