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

## 3. The owner's email

```bash
echo "OWNER_EMAIL=you@gmail.com" | sudo -u envelope tee /opt/envelope/.env
sudo chmod 600 /opt/envelope/.env
```

That's the Google account that should land in the pre-existing "Personal"
workspace instead of getting a brand-new empty one on its first sign-in.
Everyone else who signs in gets their own workspace automatically, or lands in
whatever workspace they were invited to from inside the app (see "Sharing" in
the app once you're in).

## 4. Bring your data across

Your budget lives entirely in one file. Copy it from the machine you have been
using and the app arrives with everything already in it.

```bash
# from the Windows machine
scp C:\Users\you\code\budget\data\budget.db you@server:/tmp/budget.db

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
4. Add a **Public Hostname**: `budget.yourdomain.com` routed to
   `http://localhost:4517`

The DNS record is created for you.

## 7. Access, which is the part that matters

Cloudflare Access is the entire login system now: there is no app password.
Getting this step right is not optional.

Zero Trust dashboard, then **Settings, Authentication**:

1. Add a login method: **Google**. Follow Cloudflare's prompts to create a
   Google OAuth client (Google Cloud Console → APIs & Services → Credentials);
   Cloudflare shows you exactly what redirect URI to register.

Then **Access, Applications, Add a self-hosted application**:

- Domain: whatever public hostname you routed the tunnel to
- Policy: **Allow**, selector **Login Methods**, value **Google**: deliberately
  not scoped to your email, since anyone with a Google account should be able
  to sign up for their own budget
- Under **Settings** for the application, confirm **Add Authorization Header:
  On**: this is what puts `Cf-Access-Authenticated-User-Email` on every
  request the app sees, which is the only thing `server/identity.js` trusts

This is a real login gate, not a "thin cover" the way the old email-only
policy was: Google's own account security (their own 2FA, if the visitor has
it on) sits in front of everyone who reaches the app, not just you.

Google sign-in is close to instant when the visitor is already signed into
Google in their browser: no emailed one-time code to wait on, which was the
whole reason to move off Access's default login method.

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
