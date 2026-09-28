# Hosting HakDaar on hakdaar.me

`docker compose up -d --build` runs everything:

| Service | What it does | Public? |
|---|---|---|
| `web` | Caddy: landing page (`/`), the app (`/app`), `/api` proxy, automatic HTTPS | yes (80/443) |
| `backend` | FastAPI + SQLite (volume `hakdaar-data`) | no |
| `hindsight` | Memory server (volume `hindsight-data`) | no |

The hosted build runs with `PUBLIC_MODE=true`. In that mode:
- a worker's data needs that worker's login session;
- `GET /workers`, `POST /workers` and `POST /reset` are switched off;
- the Hindsight ports are never exposed.

Pick **one** of the two options.

---

## Option A: a small server (stays online; recommended)

You need a Linux server with **4 GB RAM** (Hindsight needs most of it). Examples:
- Hetzner CX22
- DigitalOcean 4 GB droplet (the GitHub Student Pack includes credit)
- AWS Lightsail 4 GB

Use Ubuntu 24.04.

**1. Point the domain at the server.** At your domain registrar, open DNS settings for hakdaar.me:

| Type | Host | Value |
|---|---|---|
| A | `@` | your server's IP |
| A | `www` | your server's IP |

Delete any "parking" or URL-redirect records. Wait until `ping hakdaar.me` shows your server's IP (usually 5–30 minutes).

**2. On the server** (`ssh root@YOUR_IP`):

```bash
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

git clone -b claude/epic-darwin-dsg053 https://github.com/riyanshareefshaik/HakDaar.git
cd HakDaar
cp .env.example .env
nano .env
```

In `.env`, set:

```
GROQ_API_KEY=gsk_...            # a fresh key
SITE_ADDRESS=hakdaar.me, www.hakdaar.me
SESSION_SECRET=                 # paste the output of: openssl rand -hex 32
```

Then start it:

```bash
docker compose up -d --build
docker compose logs -f          # Ctrl+C to stop watching
```

Open https://hakdaar.me. Caddy gets the HTTPS certificate by itself on the first visit. That only works once DNS points at the server.

**Update later:** `git pull && docker compose up -d --build`

---

## Option B: from your Mac with a Cloudflare Tunnel (free; only online while the Mac is on)

**1. Move the domain's DNS to Cloudflare.**
- Create a free account at cloudflare.com.
- Click **Add a site** and enter `hakdaar.me`. Choose the Free plan.
- At your registrar, replace the nameservers with the two Cloudflare shows you.
- Wait for Cloudflare to say the site is **Active**.

**Shortcut for steps 2 and 3:** once Cloudflare says Active, run `./scripts/go-live.sh`. It does all of the following for you (Docker, secret, tunnel, DNS) and keeps the Mac awake.

**2. Run HakDaar in production mode on the Mac.**
- Stop the dev servers first (Ctrl+C in both terminals).
- In `.env`, set `SITE_ADDRESS=:80` and a `SESSION_SECRET`.
- Then run:

```bash
cd ~/HakDaar
docker compose up -d --build
open http://localhost           # check it works locally
```

**3. Create the tunnel:**

```bash
brew install cloudflared
cloudflared tunnel login                       # pick hakdaar.me in the browser
cloudflared tunnel create hakdaar
cloudflared tunnel route dns hakdaar hakdaar.me
cloudflared tunnel route dns hakdaar www.hakdaar.me
cloudflared tunnel run --url http://localhost:80 hakdaar
```

Keep that last command running, and stop the Mac from sleeping (System Settings → Battery/Energy). Cloudflare provides the HTTPS.

---

## Website on Vercel + backend always on (no domain needed)

Vercel only hosts the website. For phones to work at any time, the backend runs on a small cloud
server (Option A), and Vercel points at it once, permanently.

1. Create an Ubuntu 24.04 server with **4 GB RAM**. Examples:
   - DigitalOcean (the GitHub Student Pack gives $200 credit)
   - Hetzner CX22
   - Oracle Cloud Always Free (ARM)

   Note its IP, e.g. `203.0.113.7`.
2. You get a free HTTPS name for it from sslip.io. Replace the dots with dashes: `203-0-113-7.sslip.io`.
3. On the server, follow Option A step 2. In `.env`, use:
   ```
   SITE_ADDRESS=203-0-113-7.sslip.io
   CORS_ORIGINS=https://hakdaar.vercel.app
   ```
4. Check `https://203-0-113-7.sslip.io/api/health` shows `"status":"ok"`.
5. In Vercel, go to Settings → Environment Variables. Set `VITE_API_URL=https://203-0-113-7.sslip.io/api`, then redeploy.

This address never changes, so you won't need to update Vercel again. Your Mac can be off. Later you
can use `api.hakdaar.me` instead: add an A record for `api` pointing at the server IP, then set
`SITE_ADDRESS=api.hakdaar.me` and `VITE_API_URL=https://api.hakdaar.me/api`.

---

## Checks after deploying

- `https://hakdaar.me` opens the landing page.
- **Get Started** opens the account form.
- `https://hakdaar.me/api/health` shows `"status": "ok"` and `"public_mode": true`.
- Chat "I worked 5 days for Rakesh at 1000 per day". The wallet should show ₹5,000 earned straight away.
- `https://hakdaar.me/api/workers` answers `Not found`, as it should.

## Troubleshooting

| Problem | Fix |
|---|---|
| `status: degraded`, Hindsight offline | Hindsight takes 1–2 minutes to start the first time. Run `docker compose logs hindsight`. |
| HTTPS error on a server | DNS wasn't pointing at the server yet. Run `docker compose restart web` once `ping hakdaar.me` is right. |
| Out of memory / Hindsight restarting | The server needs 4 GB RAM. |
| Everyone logged out after an update | `SESSION_SECRET` changed. Keep it the same in `.env`. |

Back up `/data/hakdaar.db` (volume `hakdaar-data`) if the data matters:

```bash
docker compose cp backend:/data/hakdaar.db ./backup.db
```
