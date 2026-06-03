# World Cup Trading Game

A paper trading platform for office World Cup sweepstakes.

Players receive physical teams in a draw and can then trade positions in a paper market — buying and selling teams against each other for cash or in team swaps. At the end of the tournament, paper positions settle against the physical payoff structure.

---

## Getting started

### For admins

1. **Deploy the app** — see [Running locally](#running-locally) or [Deploying to Fly.io](#deploying-to-flyio).
2. **Set your admin passphrase** via the `WCTG_ADMIN_PASS` environment variable (defaults to `changeme` — change it before sharing the link).
3. **Add players** — go to `/admin`, log in with your passphrase, then add players one by one or upload a CSV/XLSX with Name and Email columns.
4. **Run the draw** — go to `/draw`. Fire player balls one at a time or use Auto-fire. Each player ball collides with a team ball; when they stick, that's the assignment. Accept the result when you're happy — you can re-run as many times as you like before accepting.
5. **Share the link** — send everyone the URL. They log in by picking their name from the dropdown on the New Trade page.
6. **Send daily reports** — go to `/report` and click the email button to open a pre-filled email to all players with the day's trades and current positions.

### For players

1. **Log in** — go to `/trade` and pick your name from the dropdown. This sets a cookie that remembers you — you won't need to do it again on the same device.
2. **Check your draw result** — go to `/draw/results` to see which team(s) you were assigned in the physical draw.
3. **Set up push notifications** (optional but recommended) — install the [Ntfy app](https://ntfy.sh), choose a private topic name (e.g. `wctg-alice-4xk9`), subscribe to it in the app, then enter it in your row on the `/players` page. You'll then get a push notification with Confirm and Reject buttons whenever someone trades with you.
4. **Submit a trade** — go to `/trade`, pick the other party, add legs (BUY or SELL, team, quantity, and cash or swap consideration), and submit. The counterparty is notified.
5. **Confirm or reject trades** — when someone trades with you, you'll get a notification (Ntfy push or a mailto link). Click Confirm or Reject.
6. **Track positions** — go to `/positions` to see everyone's net paper exposure per team.

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
| `/players` | View players; update your own display name and Ntfy topic |
| `/draw` | Run the animated sweepstake draw to assign teams to players |
| `/draw/results` | View saved draw results |
| `/admin` | Players, snapshots, Excel export/import, tournament reset, and SAR (passphrase required for write operations) |

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

The admin page (`/admin`) is split into two sections:

**Public (no login required)**
- **Suspicious Activity Report** — log of identity switches, failed login attempts, and devtools usage, with timestamp, IP address, and user agent. Visible to all players as a deterrent.
- **IP Activity** — lists every IP seen logging in or submitting a trade, with the player identities and trade IDs associated with it. Useful for spotting impersonation.
- **Snapshots** — view the list of saved database snapshots (restore is admin-only).
- **Excel export** — download the full database as a `.xlsx` workbook (one sheet per table). No login required.

**Admin only (passphrase required)**
- **God Mode** — when enabled, all trades and amendments you submit are auto-confirmed instantly, and you can confirm or reject any trade regardless of which party you are. Cleared when you log in as a player.
- **Players** — add, edit (name, email, Ntfy topic), delete, or bulk-upload players from a CSV/XLSX file (merge or overwrite mode).
- **Snapshots** — save a point-in-time copy of the entire database; restore any snapshot with one click (the current state is automatically snapshotted before any restore or import, so you can always undo).
- **Excel import** — upload a workbook in the same format to overwrite the database.
- **Tournament Reset** — selectively delete trades, SAR logs, draw results, players, or teams to start fresh. A snapshot is taken automatically before any data is cleared.
- **SAR clear** — mark all SAR entries as read to clear the report.

Set the admin passphrase via the `WCTG_ADMIN_PASS` environment variable (defaults to `changeme`).

---

## Running locally

**Prerequisites:** Node.js 22+

```sh
npm install
npm start          # http://localhost:3000
```

The database is a single SQLite file (`wctg.db`) created on first run. Teams are seeded automatically on first start. Delete the file to start fresh.

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
   fly secrets set WCTG_ADMIN_PASS=<choose>
   ```
Where you need to `<choose>` your own passphrase to access the Admin panel.
5. **Deploy**
   ```sh
   fly deploy
   ```
   Teams are seeded automatically on first start. Add players via the Admin page once deployed.

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

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./wctg.db` | Path to the SQLite file |
| `NTFY_BASE` | `https://ntfy.sh` | Ntfy server base URL (change if self-hosting) |
| `WCTG_ADMIN_PASS` | `changeme` | Passphrase for the admin panel — change this in production |
