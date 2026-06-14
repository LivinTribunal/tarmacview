# Database Backups

Daily local backups of the PostgreSQL database so we don't lose real data if the `pgdata` Docker volume is corrupted or wiped.

## Overview

`scripts/backup_db.sh` runs `pg_dump -Fc` (custom format) against the running `postgres` service in `docker-compose.yml` and writes a timestamped dump to a configurable directory. Old dumps beyond a retention count are pruned automatically.

- Default target: `./backups/tarmacview-YYYYMMDD-HHMMSS.dump` (UTC timestamp)
- Default retention: 30 daily dumps (~1 month)
- The `backups/` directory is git-ignored.

## Prerequisites

- Docker Compose v2 on the host.
- The `postgres` service from `docker-compose.yml` running: `docker compose up -d postgres`.
- Same env vars the stack uses (`POSTGRES_DB`, `POSTGRES_USER`) — defaults match `.env.docker.example`.

## Run manually

```bash
./scripts/backup_db.sh
```

Sample output:

```
Dumping tarmacview from container 'postgres' -> /repo/backups/tarmacview-20260427-031500.dump
Wrote /repo/backups/tarmacview-20260427-031500.dump (12M)
Retention: keeping 8 of last 8; pruned 1
```

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `POSTGRES_DB` | `tarmacview` | Database name to dump. |
| `POSTGRES_USER` | `tarmacview` | DB user with read access. |
| `BACKUP_DIR` | `<repo>/backups` | Target directory. Created if missing. |
| `BACKUP_RETENTION` | `30` | Number of newest dumps to keep. |
| `COMPOSE_SERVICE` | `postgres` | Compose service name running Postgres. |

Example with overrides:

```bash
BACKUP_DIR=/var/backups/tarmacview BACKUP_RETENTION=12 ./scripts/backup_db.sh
```

## Scheduling

Pick whichever scheduler matches the host. Cron is the recommended default.

### cron (Linux/macOS)

Edit the crontab with `crontab -e` and add a daily entry — 03:00 local time:

```cron
0 3 * * * cd /full/path/to/drone-mission-planning-module && ./scripts/backup_db.sh >> /var/log/tarmacview-backup.log 2>&1
```

The `cd` is required so `git rev-parse --show-toplevel` resolves the repo root.

### systemd timer (Linux)

`/etc/systemd/system/tarmacview-backup.service`:

```ini
[Unit]
Description=TarmacView daily DB backup
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/full/path/to/drone-mission-planning-module
ExecStart=/full/path/to/drone-mission-planning-module/scripts/backup_db.sh
User=youruser
```

`/etc/systemd/system/tarmacview-backup.timer`:

```ini
[Unit]
Description=Run TarmacView DB backup daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tarmacview-backup.timer
```

### launchd (macOS)

`~/Library/LaunchAgents/com.tarmacview.backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.tarmacview.backup</string>
    <key>ProgramArguments</key>
    <array>
      <string>/full/path/to/drone-mission-planning-module/scripts/backup_db.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/full/path/to/drone-mission-planning-module</string>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key><integer>3</integer>
      <key>Minute</key><integer>0</integer>
    </dict>
    <key>StandardOutPath</key><string>/tmp/tarmacview-backup.log</string>
    <key>StandardErrorPath</key><string>/tmp/tarmacview-backup.log</string>
  </dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.tarmacview.backup.plist
```

## Restore

The dumps are PostgreSQL custom-format archives (`-Fc`), so use `pg_restore`.

### Restore into the existing database

This drops and recreates objects in place. Make sure the app is stopped first.

```bash
docker compose exec -T postgres \
  pg_restore --clean --if-exists --no-owner -U tarmacview -d tarmacview \
  < backups/tarmacview-YYYYMMDD-HHMMSS.dump
```

### Restore into a fresh database

Useful for verifying a dump or spinning up an isolated copy:

```bash
# create an empty target db
docker compose exec -T postgres \
  createdb -U tarmacview tarmacview_restore_test

# load the dump
docker compose exec -T postgres \
  pg_restore --no-owner -U tarmacview -d tarmacview_restore_test \
  < backups/tarmacview-YYYYMMDD-HHMMSS.dump
```

After verifying, drop it again with `dropdb -U tarmacview tarmacview_restore_test`.

## Verification

Test a restore at least once after setting up scheduling — a backup that has never been replayed isn't really a backup. The "fresh database" recipe above is the cheapest way to do it.

## Troubleshooting

- **"compose service 'postgres' is not running"** — start the stack first: `docker compose up -d postgres`.
- **Disk fills up** — lower `BACKUP_RETENTION` or move `BACKUP_DIR` to a larger volume.
- **Permission denied on `BACKUP_DIR`** — the user running the script needs write access; for cron jobs, double-check the user.
- **`bash: mapfile: command not found` on macOS** — system bash on macOS is 3.2 and lacks some bashisms. The script avoids `mapfile` for this reason, but if you've forked and reintroduced it (or hit a similar bash 4+ feature), install a newer bash with `brew install bash` and run the script with `/opt/homebrew/bin/bash ./scripts/backup_db.sh` (or `/usr/local/bin/bash` on Intel Macs).
