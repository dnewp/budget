# Deploying Envelope

Target: a Linux box you control, reached from anywhere through a Cloudflare
Tunnel. Nothing is exposed to the internet directly and no ports are forwarded.

Read the whole of step 1 before starting. The Node version is the thing most
likely to trip you up.

---

## 1. Node 22 or newer, not the distro package

The app uses Node's built-in `node:sqlite`, so there is nothing to compile, but
that module only exists in **Node 22.5+** and is only stable without a flag in
**Node 23.4+**. Use Node 24. Ubuntu's own `nodejs` package is far too old and
will fail with `Cannot find module 'node:sqlite'`.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git sqlite3
node --version    # expect v24.x
```

`sqlite3` is optional but worth having: the deploy script uses it to back up a
live database safely, and falls back to `cp` if it is missing.

## 2. A user and a home for the app

Running as its own user means a compromise of the app is not a compromise of
your account.

```bash
sudo useradd --system --create-home --home-dir /opt/envelope --shell /usr/sbin/nologin envelope
sudo -u envelope git clone https://github.com/dnewp/budget.git /opt/envelope
cd /opt/envelope
sudo -u envelope npm ci
sudo -u envelope npm run build
```

## 3. Password and secrets

```bash
sudo -u envelope npm run set-password -- 'a-real-password'
```

That writes `BUDGET_PASSWORD_HASH` and a random `SESSION_SECRET` into
`/opt/envelope/.env`. That file is gitignored and must never be committed.

```bash
sudo chmod 600 /opt/envelope/.env
```

## 4. Bring your data across

Your budget lives entirely in one file. Copy it from the machine you have been
using and the app arrives with everything already in it.

```bash
# from the Windows machine
scp C:\Users\DillonNewport\code\budget\data\budget.db you@server:/tmp/budget.db

# on the server
sudo -u envelope mkdir -p /opt/envelope/data
sudo cp /tmp/budget.db /opt/envelope/data/budget.db
sudo chown envelope:envelope /opt/envelope/data/budget.db
```

Stop the app on the Windows side first, or you may copy a database mid-write.

## 5. Run it as a service

```bash
sudo cp /opt/envelope/deploy/envelope.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now envelope
systemctl status envelope
curl -s localhost:4517 | head -5      # expect HTML
```

The unit sets `HOST=127.0.0.1`, so the app answers only to the machine itself.
The tunnel is the only way in.

## 6. The tunnel

Cloudflare recommends creating the tunnel in the dashboard rather than locally,
and it is less work:

1. Zero Trust dashboard, then **Networks, Tunnels, Create a tunnel**, cloudflared
2. Name it `envelope`, choose Debian, and copy the install command it shows
3. Run that command on the server. It installs cloudflared and registers it as a
   service
4. Add a **Public Hostname**: `budget.dnewport.dev` routed to
   `http://localhost:4517`

The DNS record is created for you.

## 7. Access, which is the part that matters

The tunnel makes the app reachable from anywhere, and a password is thin cover
for your entire financial position.

Zero Trust dashboard, then **Access, Applications, Add a self-hosted
application**:

- Domain: `budget.dnewport.dev`
- Policy: **Allow**, with the selector **Emails** set to your own address

Cloudflare then makes you authenticate before a request ever reaches the server.
Scanners and bots never touch it, and the app password becomes a second factor
rather than the only one. This is on the free plan.

Once this is on, the `Secure` cookie flag activates by itself, because the app
can see from `x-forwarded-proto` that the connection is HTTPS.

## 8. Updating

By hand whenever you want:

```bash
sudo -u envelope /opt/envelope/deploy/deploy.sh
```

It backs up the database first, does nothing if there are no new commits, only
reinstalls dependencies when the lockfile moved, and reports whether the service
came back up.

To pick up new commits automatically every five minutes:

```bash
sudo cp /opt/envelope/deploy/envelope-deploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now envelope-deploy.timer
systemctl list-timers envelope-deploy
```

The deploy script restarts the service, so give the `envelope` user permission
for exactly that one command and nothing else:

```bash
echo 'envelope ALL=(root) NOPASSWD: /usr/bin/systemctl restart envelope' | \
  sudo tee /etc/sudoers.d/envelope-deploy
sudo chmod 440 /etc/sudoers.d/envelope-deploy
```

## Backups

Every deploy keeps a dated copy in `/opt/envelope/backups`, most recent 30.
Those live on the same disk, so they protect you from a bad migration but not
from losing the machine. Copy them somewhere else periodically.

```bash
sudo systemctl stop envelope
sudo -u envelope sqlite3 /opt/envelope/data/budget.db ".backup '/tmp/budget-restore.db'"
sudo systemctl start envelope
```

## When something is wrong

```bash
journalctl -u envelope -n 50 --no-pager          # app logs
journalctl -u envelope-deploy -n 50 --no-pager   # deploy logs
systemctl status cloudflared
```

`Cannot find module 'node:sqlite'` means Node is too old; go back to step 1.

A login that appears to do nothing, over plain HTTP, means the `Secure` cookie
flag is being set when it should not be. Check what `x-forwarded-proto` the
proxy in front is sending.
