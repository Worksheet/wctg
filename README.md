# World Cup Trading Game

A paper trading platform for office World Cup sweepstakes.

Players receive physical teams in a draw and can then trade positions in a paper market — buying and selling teams against each other for cash or in team swaps. At the end of the tournament, paper positions settle against the physical payoff structure.

---

## Running locally

**Prerequisites:** Node.js 22+

```sh
npm install
node seed.js       # load teams and initial players (safe to re-run)
npm start          # http://localhost:3000
```

The database is a single SQLite file (`wctg.db`) created on first run. Delete it to start fresh.

---

## Deploying to Fly.io

Fly.io is the recommended host. It handles TLS automatically and the free tier is sufficient.

### First-time setup

1. **Install the Fly CLI**
   ```sh
   # macOS/Linux
   curl -L https://fly.io/install.sh | sh
   # Windows
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

2. **Log in**
   ```sh
   fly auth login
   ```

3. **Create the app and a persistent volume** (the volume stores the SQLite file across deploys)
   ```sh
   fly launch --name wctg --region lhr --no-deploy
   fly volumes create wctg_data --region lhr --size 1
   ```

4. **Set environment variables**
   ```sh
   fly secrets set NTFY_BASE=https://ntfy.sh
   ```

5. **Seed and deploy**
   ```sh
   fly deploy
   fly ssh console -C "node seed.js"
   ```

6. **Point your domain** — add an A record pointing to your Fly app's IP (`fly ips list`), then:
   ```sh
   fly certs add yourdomain.com
   ```

### Subsequent deploys

```sh
fly deploy
```

Or set up GitHub Actions to deploy on push to `main`:

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: fly deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Add `FLY_API_TOKEN` (from `fly tokens create deploy`) to your GitHub repo secrets.

### Estimated cost

| Resource | Cost |
|---|---|
| Fly `shared-cpu-1x` VM | Free tier (up to 3 VMs) |
| 1 GB persistent volume | ~$0.15/month |
| TLS certificate | Free |
| **Total** | **~$0–1/month** |

---

## Deploying to AWS (Lightsail)

If you prefer to use your existing AWS account:

1. Launch a Lightsail instance — **Ubuntu 24 LTS, $5/month plan** (1 vCPU, 1 GB RAM).
2. Open ports 80, 443, and 22 in the Lightsail firewall.
3. Point your domain's A record at the instance's static IP.
4. SSH in and run:

```sh
# Install Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install Caddy (handles TLS automatically)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# Install PM2
sudo npm install -g pm2

# Deploy the app
git clone https://github.com/youruser/wctg.git /opt/wctg
cd /opt/wctg && npm ci --omit=dev
node seed.js
pm2 start server.js --name wctg
pm2 save && pm2 startup
```

5. Configure Caddy (`/etc/caddy/Caddyfile`):

```
yourdomain.com {
    reverse_proxy localhost:3000
}
```

```sh
sudo systemctl reload caddy
```

TLS is provisioned automatically from Let's Encrypt.

---

## Pages

| URL | What it does |
|---|---|
| `/trade` | Submit a new trade |
| `/blotter` | All trades, filterable by status and player |
| `/blotter/:id` | Trade detail, amendment history, and confirm/reject links |
| `/blotter/:id/amend` | Amend a pending or confirmed trade |
| `/positions` | Position matrix — teams × players, confirmed trades only |
| `/report` | Daily report with one-click send to all players |
| `/players` | Player management and Ntfy topic setup |
| `/admin` | Snapshots, Excel export/import, Suspicious Activity Report |

---

## How trades work

### Login

There are no accounts or passwords. On the **New Trade** page, select your name from the login dropdown. This sets a browser cookie that remembers who you are. The cookie is used to:

- Pre-fill the Writer field when submitting trades
- Block you from confirming trades you wrote yourself
- Restrict amending trades to parties on the trade

Switching to a different player is always possible but is logged in the **Suspicious Activity Report** on the Admin page.

### Entering a trade

1. Go to **New Trade**.
2. Select the **writer** (the person proposing the trade) and **counterparty**.
3. Add one or more legs. Each leg is:
   - **BUY or SELL** — from the writer's perspective
   - **Team** and **quantity** (whole numbers only)
   - **Cash** (£ amount) or **Swap** (a second team and quantity) as consideration
4. Add an optional note.
5. Submit. If any leg involves a SELL or swap (i.e. any liability), a disclaimer appears first.

### Confirmation

After submitting, the counterparty is notified. If they have an Ntfy topic set, they get a push notification with **Confirm** and **Reject** buttons. Otherwise, a mailto link pre-filled with the trade details and confirm/reject URLs is shown for the writer to forward.

If the writer accidentally clicks their own confirm link they see a message explaining this, with the links shown for copy-pasting to the counterparty.

### Amendments

Open any pending or confirmed trade from the blotter and click **Amend**. You must be logged in as a party to the trade. The writer and counterparty are locked; only the legs and note change.

- The amending party's agreement is **auto-confirmed** — only the other party is notified and needs to respond.
- Pending amendments **expire after 24 hours** if not acted on.
- A new amendment **supersedes** any previous pending amendment on the same trade (the old one is kept for audit but has no effect).
- The original trade **stays live in positions** until an amendment is confirmed. Rejected or expired amendments leave the original trade unchanged.

### Positions

The positions screen shows net paper exposure per player per team, derived from **confirmed trades only**. Long positions are green, short positions are red. Teams with all-zero positions are hidden.

---

## Setting up Ntfy push notifications

Ntfy delivers trade notifications directly to players' phones without needing email infrastructure.

### Each player does this once

1. **Install the app**
   - Android: [ntfy on Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
   - iOS: [ntfy on App Store](https://apps.apple.com/app/ntfy/id1625396347)
   - Web: [ntfy.sh](https://ntfy.sh)

2. **Choose a private topic name** — something hard to guess, like `wctg-alice-4xk9`. Anyone who knows the topic can send you notifications, so treat it like a semi-secret.

3. **Subscribe** — open the app, tap +, type your topic name. No account needed.

4. **Register your topic** — go to `/players`, find your row, type the topic name into the Ntfy topic field, and click Save.

From that point on, when someone submits a trade with you as counterparty you'll get a push notification with **Confirm** and **Reject** buttons. If no topic is set, the writer gets a mailto link instead.

---

## Admin

The admin page (`/admin`) is open to everyone — there is no password. It provides:

- **Snapshots** — save a point-in-time copy of the entire database; restore any snapshot with one click (the current state is automatically snapshotted before any restore or import, so you can always undo)
- **Excel export** — download the full database as a `.xlsx` workbook (one sheet per table)
- **Excel import** — upload a workbook in the same format to overwrite the database
- **Suspicious Activity Report** — log of every player identity switch, with timestamp, IP address, and user agent

Player management (add, edit, delete, Ntfy topics) is on the **Players** page (`/players`).

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./wctg.db` | Path to the SQLite file |
| `NTFY_BASE` | `https://ntfy.sh` | Ntfy server base URL (change if self-hosting) |
