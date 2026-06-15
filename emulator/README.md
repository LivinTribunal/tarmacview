# emulator/

Cert-free run-kit that drives **real DJI Pilot 2 (in BlueStacks)** against the
**real fieldhub** — plain HTTP on `http://10.0.2.2:8080`, no postgres, no TLS.
It is the BlueStacks counterpart to the production HTTPS `field` compose profile:
Pilot's native Cloud Service flow connects over HTTP with **no certificate**, so
it sidesteps the local-CA trust step that the emulator's WebView can't satisfy.

Full procedure: [`docs/emulator-validation.md`](../docs/emulator-validation.md).

```bash
cp emulator/.env.emulator.example emulator/.env.emulator   # then fill in DJI app creds
# the field profile shares minio's console port (9001) - stop it first:
docker compose --profile field stop
docker compose --env-file emulator/.env.emulator -f emulator/docker-compose.emulator.yml up -d --build
```

Then in BlueStacks: **DJI Pilot 2 → Cloud Service → third-party platform**, enter
`http://10.0.2.2:8080`.

`--env-file` is required: compose interpolates `${VAR}` in the compose file from
it. (`environment:` overrides `env_file:`, so a plain `env_file` would be
silently ignored for these vars.)

- `docker-compose.emulator.yml` — fieldhub (plain HTTP) + MinIO + EMQX (plain
  MQTT) + nginx.
- `nginx.conf` — the single device-facing port (8080); bucket paths → MinIO
  preserving the signed Host, everything else → fieldhub.
- `seed-wayline.sh` — register a KMZ into the wayline library (stands in for the
  backend's dispatch).
- `.env.emulator.example` — copy to `.env.emulator` (git-ignored) and fill in.

## Production vs emulator

| | `field` profile (production) | `emulator/` (this kit) |
|---|---|---|
| Transport | HTTPS `:8443` + MQTTS `:8883`, local CA | plain HTTP `:8080` + MQTT `:1883` |
| Cert trust on device | CA installed on each RC | none needed |
| Registry | postgres (`fieldhub` schema) | throwaway sqlite |
| Brought up by | `./start-field.sh` | command above |
| Reached at | `https://<lan-ip>:8443` | `http://10.0.2.2:8080` |

They both build the same `fieldhub` image and are mutually exclusive (shared
host ports). Use the emulator for BlueStacks connect/login validation; use the
`field` profile for real RC hardware (where TLS + the installed CA are required).

## Teardown

```bash
docker compose --env-file emulator/.env.emulator -f emulator/docker-compose.emulator.yml down -v
```
