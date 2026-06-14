# DJI Cloud API Reference — fieldhub implementation contract

The protocol surface the `fieldhub` service implements so DJI Pilot 2 can use
TarmacView as its "third-party cloud platform" over the local network. This is
the **single protocol source of truth for implementation work** — pipeline
agents have no web access; everything needed for the field-hub issues is
inline here.

**Provenance.** Extracted from the DJI Cloud API Demo v1.10 source (the
reference implementation Pilot 2 ships against; archived locally in the
`field-hub-spike/` workspace on the field laptop) and cross-checked against
the public Cloud-API-Doc. A live demo stack validated the platform side.
**Hardware verdicts are pending** — items marked ⚠ UNVERIFIED get confirmed
or corrected on the real RC Plus 2 / RC Plus; deltas are folded back into
this doc.

Companion docs: architecture `FIELD-HUB.md` · KMZ/WPML payload format
`dji-wpml-reference.md`.

## 1. Connection bootstrap (Pilot 2 → platform)

1. Operator opens DJI Pilot 2 → *Cloud Service* → enters the platform URL
   (e.g. `https://192.168.8.100:8443`). Pilot loads that page in its
   embedded webview.
2. The page (served by the hub) drives Pilot through `window.djiBridge`
   (JSBridge): it verifies the **app credentials** (`appId`, `appKey`,
   `appLicense` — the DJI developer app bound to the platform; license
   verification requires internet at least once ⚠ UNVERIFIED how long the
   verification caches offline).
3. The page calls the platform's **login** endpoint with operator
   credentials; the response carries everything Pilot needs to attach:
   workspace, JWT for HTTP, and MQTT address + per-user MQTT credentials.
4. The page loads JSBridge modules (`api` with the host + token, `thing`
   with the MQTT params) — Pilot's *thing* module connects to the broker
   and publishes its device topology (`update_topo`). The platform replies;
   the RC and (when powered) the aircraft are now online.
5. All subsequent traffic: HTTPS calls Pilot-initiated (wayline lists, media
   negotiation) + MQTT both ways (status, OSD, events, requests).

## 2. HTTP conventions

- Every response uses the demo's envelope (`HttpResultResponse`):

  ```json
  {"code": 0, "message": "success", "data": { ... }}
  ```

  `code: 0` = success; non-zero = failure with `message`. Pilot checks the
  envelope, not HTTP status alone.
- After login, Pilot sends the JWT on every request in the
  **`x-auth-token`** header.
- Module prefixes (all under `/{prefix}/api/v1`):

  | module | prefix | used by fieldhub for |
  |---|---|---|
  | manage | `/manage/api/v1` | login, workspace, devices/binding |
  | wayline | `/wayline/api/v1` | route library sync + dispatch |
  | media | `/media/api/v1` | fast-upload negotiation + callbacks |
  | storage | `/storage/api/v1` | temporary object-store credentials (STS) |
  | tsa | `/manage/api/v1` (impl) | device topology for situational awareness |
  | map, control | `/map`, `/control` | **out of scope** for fieldhub v1 |

- Paging convention on list endpoints: `page` (1-based), `page_size`;
  list payloads come wrapped as `{"list": [...], "pagination": {"page": n,
  "page_size": n, "total": n}}`.

## 3. Endpoints the hub must serve

### 3.1 manage — login & devices

| method + path | purpose |
|---|---|
| `POST /manage/api/v1/login` | operator/Pilot login. Body `{username, password, flag}` (`flag` distinguishes web vs Pilot client). |
| `POST /manage/api/v1/token/refresh` | JWT refresh. |
| `GET /manage/api/v1/workspaces/current` | workspace of the authenticated user (id, name). |
| `GET /manage/api/v1/devices/{workspace_id}/devices` | all devices in the workspace. |
| `GET /manage/api/v1/devices/{workspace_id}/devices/{device_sn}` | one device. |
| `GET /manage/api/v1/devices/{workspace_id}/devices/bound` | bound devices (paged). |
| `POST /manage/api/v1/devices/{device_sn}/binding` | bind a device to the workspace. |
| `DELETE /manage/api/v1/devices/{device_sn}/unbinding` | unbind. |
| `PUT /manage/api/v1/devices/{workspace_id}/devices/{device_sn}` | rename etc. |

Login response `data` (demo `UserDTO`) — the contract that attaches Pilot:

```json
{
  "user_id": "...", "username": "...", "user_type": 2,
  "workspace_id": "...",
  "access_token": "<jwt for x-auth-token>",
  "mqtt_addr": "tcp://192.168.8.100:1883",
  "mqtt_username": "...", "mqtt_password": "..."
}
```

Notes:
- `mqtt_addr` format is `<scheme>://<host>:<port>`. The demo uses `tcp://`;
  for the fieldhub the broker is MQTTS — scheme/port for TLS
  (`ssl://host:8883`) ⚠ UNVERIFIED on hardware, confirm Pilot accepts it
  with the locally-installed CA.
- The address must be reachable **from the RC on the WiFi** (LAN IP, never
  a compose hostname). If the hub itself also connects to the broker, it
  must use the compose-internal address — never reuse the device-facing one
  (Docker Desktop does not hairpin container→host-LAN-IP traffic; found
  empirically during the spike).

### 3.2 wayline — route library (dispatch leg)

| method + path | purpose |
|---|---|
| `GET /wayline/api/v1/workspaces/{workspace_id}/waylines` | paged route list Pilot syncs from. Query: `page`, `page_size`, `order_by`, `favorited`, `template_type`, `action_type`, `drone_model_keys`, `payload_model_key`, `key` (name search). |
| `GET /wayline/api/v1/workspaces/{workspace_id}/waylines/{wayline_id}/url` | download of the KMZ — the demo answers with a redirect to a presigned object-store URL; the presigned host must be the LAN-reachable MinIO address. |
| `GET /wayline/api/v1/workspaces/{workspace_id}/waylines/duplicate-names` | name-collision check (`name` query param, returns colliding names). |
| `POST /wayline/api/v1/workspaces/{workspace_id}/upload-callback` | Pilot reports a wayline *it* uploaded to object storage (RC→cloud direction; lets operators push routes from Pilot). |
| `POST /wayline/api/v1/workspaces/{workspace_id}/waylines/file/upload` | direct multipart upload (web UI path; TarmacView dispatch can reuse it server-side). |
| `POST /wayline/api/v1/workspaces/{workspace_id}/favorites` + `DELETE` | mark/unmark favorites (ids in body). |
| `DELETE /wayline/api/v1/workspaces/{workspace_id}/waylines/{wayline_id}` | delete a wayline. |

Wayline list item (demo `GetWaylineListResponse`) — what Pilot renders in
its route library:

```json
{
  "id": "<uuid>", "name": "RWY22 PAPI inspection",
  "drone_model_key": "0-89-0",
  "payload_model_keys": ["1-53-0"],
  "template_types": [0],
  "object_key": "wayline/<file>.kmz",
  "sign": "<md5 of the kmz>",
  "favorited": false, "username": "...",
  "create_time": 1733700000000, "update_time": 1733700000000
}
```

- `drone_model_key` / `payload_model_keys` are `domain-type-subtype` strings
  (see §6) — Pilot **filters the list by the connected aircraft**, so a
  wayline whose `drone_model_key` doesn't match the connected drone may not
  appear. Populate from the mission's drone profile.
- `template_types`: 0 = waypoint. `sign` is the file checksum (md5) ⚠
  UNVERIFIED whether Pilot enforces it; the demo computes it on upload.
- The KMZ itself must contain `wpmz/template.kml` (+ `waylines.wpml`) — the
  TarmacView exporter already emits both (`dji-wpml-reference.md`).
- Pilot triggers the sync itself (pull). Refresh cadence / manual
  pull-to-refresh behavior in the route list UI ⚠ UNVERIFIED (V2).

### 3.3 storage + media — media return leg

| method + path | purpose |
|---|---|
| `POST /storage/api/v1/workspaces/{workspace_id}/sts` | temporary object-store credentials for direct upload. |
| `POST /media/api/v1/workspaces/{workspace_id}/fast-upload` | fingerprint pre-check: Pilot asks "do you already have this file?" before uploading. |
| `POST /media/api/v1/workspaces/{workspace_id}/files/tiny-fingerprints` | batch variant — Pilot sends the tiny-fingerprint list, platform answers which already exist. |
| `POST /media/api/v1/workspaces/{workspace_id}/upload-callback` | Pilot reports a completed upload with full file metadata — **this is the hub→backend media-event trigger**. |
| `POST /media/api/v1/workspaces/{workspace_id}/group-upload-callback` | folder/group variant of the callback. |
| `GET /media/api/v1/files/{workspace_id}/files` | uploaded-files list (paged; web UI). |
| `GET /media/api/v1/files/{workspace_id}/file/{file_id}/url` | presigned download URL for a stored file. |

STS response `data` (demo `StsCredentialsResponse`):

```json
{
  "bucket": "cloud-bucket",
  "endpoint": "http://192.168.8.100:9000",
  "provider": "minio",
  "region": "us-east-1",
  "object_key_prefix": "media",
  "credentials": {
    "access_key_id": "...", "access_key_secret": "...",
    "security_token": "...", "expire": 3600
  }
}
```

- `provider` ∈ `minio | aws | ali` (`OssTypeEnum`) — Pilot picks its S3
  client accordingly. MinIO works via its AssumeRole STS API (validated
  against the demo; on-hardware confirmation is V4).
- `endpoint` must be the **LAN-reachable** MinIO address — Pilot uploads
  directly to it with the temporary credentials.
- Devices may also request the same config over MQTT (`storage_config_get`
  on the requests topic, §4) — implement both paths against one source.

Upload callback body (demo `MediaUploadCallbackRequest`): `{fingerprint,
name, path, object_key, sub_file_type, metadata, ext}` where `metadata`
(demo `MediaFileMetadata`) is the matching input for TarmacView:

```json
{
  "absolute_altitude": 423.6,
  "relative_altitude": 38.2,
  "gimbal_yaw_degree": -87.5,
  "created_time": "2026-06-09T14:21:33+02:00",
  "shoot_position": {"lat": 48.17, "lng": 17.21}
}
```

`ext` (`MediaFileExtension`) carries drone SN / payload info and the
`fileGroupId`/`flightId` linkage when present. Persist the callback payload
verbatim alongside the derived `drone_media_file` row — capture time and
shoot position drive mission matching; never substitute server receive time.

### 3.4 tsa — topology (situational awareness)

`GET /manage/api/v1/workspaces/{workspace_id}/devices/topologies` — Pilot's
TSA module fetches the device tree (gateways + aircraft) to render what's
online. Serve it from the hub's device registry; it is also a convenient
backing source for TarmacView's field-link status endpoint.

## 4. MQTT contract

Topic families (from the SDK's `TopicConst`; `{sn}` = device serial,
gateway = the RC):

| topic | direction | purpose |
|---|---|---|
| `sys/product/{gateway_sn}/status` | device → cloud | lifecycle: `update_topo` on connect/topology change (aircraft attached/detached, going offline) |
| `sys/product/{gateway_sn}/status_reply` | cloud → device | ack: `{"method": "update_topo", "data": {"result": 0}}` |
| `thing/product/{sn}/osd` | device → cloud | periodic telemetry (position, battery, attitude) |
| `thing/product/{sn}/state` | device → cloud | sparse state changes (firmware, payload, live-capacity) |
| `thing/product/{sn}/services` + `_reply` | cloud → device | commands the cloud invokes on the device |
| `thing/product/{sn}/events` + `_reply` | device → cloud | device-initiated notifications (file upload progress, HMS); some demand a reply with `result` |
| `thing/product/{sn}/requests` + `_reply` | device → cloud | device asks the cloud for data — incl. `airport_organization_get`/`airport_organization_bind` (binding) and **`storage_config_get`** (STS for media/logs) |
| `thing/product/{sn}/property/set` | cloud → device | property writes |
| `thing/product/{sn}/drc/up` / `/down` | both | DRC live-control link — **out of scope** for fieldhub v1 |

Message envelope, both directions (SDK `CommonTopicRequest/Response`):

```json
{"tid": "<uuid per transaction>", "bid": "<uuid per business flow>",
 "timestamp": 1733700000000, "method": "update_topo", "data": { ... }}
```

Replies echo `tid`/`bid` and return `{"result": 0}` inside `data` (0 = ok).
`method` appears on methodful topics (status/services/events/requests).

Behavioral notes:
- The hub subscribes its full bootstrap set with `+` wildcards at startup:
  `sys/product/+/status`, `thing/product/+/requests`, `thing/product/+/events`,
  and `thing/product/+/osd|state` (the telemetry pair only refreshes the online
  ttl). It acks any event whose envelope sets `need_reply: 1` on
  `…/events_reply`, echoing `tid`/`bid` with `{"result": 0}`; events without the
  flag are ignored, with no payload interpretation or db write.
- Acks publish at **QoS 1**. DJI blocks on reliable ack delivery to clear the
  device's pending-connection indicator; a dropped QoS-0 ack can leave it stuck.
- **Online/offline**: a gateway is online after `update_topo`; the aircraft
  appears as a sub-device in the topology payload. Offline = MQTT
  disconnect (track broker client events and/or MQTT last-will) or an
  `update_topo` without the sub-device. Demo keeps device state in Redis
  with a TTL refreshed by OSD traffic — the fieldhub equivalent must expire
  stale devices.
- Per-user MQTT credentials come from login (§3.1); the broker currently
  accepts TLS-anonymous clients (skeleton); per-device credentials land
  with the binding slice.

## 5. Pilot webview / JSBridge (connect page)

Implemented: the hub serves its own connect page at `GET /` (plain HTML +
vanilla JS under `fieldhub/app/static/`, no build step, all assets local —
the field network has no internet). `GET /pilot/config` supplies the page's
bootstrap as an envelope — the DJI app credentials from hub settings
(`FIELDHUB_DJI_APP_ID` / `_DJI_APP_KEY` / `_DJI_APP_LICENSE`; never
hardcoded in the page), the device-facing `mqtt_addr`, and the
platform/workspace identity:

```json
{"app_id": "...", "app_key": "...", "app_license": "...",
 "mqtt_addr": "ssl://192.168.8.100:8883",
 "platform_name": "TarmacView Field Hub",
 "workspace_name": "TarmacView Field", "workspace_desc": ""}
```

Unconfigured credentials → non-zero envelope code and the page stops at the
license step with the message. The endpoint is unauthenticated by design —
the page needs it before login; LAN-only surface, same posture as login.

Call sequence (`pilot-connect.js`; each step gates the next, the first
failure stops the flow and renders the error in plain text on the status
panel):

1. `GET /pilot/config` → bootstrap above.
2. `platformVerifyLicense(appId, appKey, appLicense)`, then
   `platformIsVerified()`.
3. Operator login form → `POST /manage/api/v1/login` `{username, password,
   flag: 2}` → `access_token`, `mqtt_*`, `workspace_id` (§3.1).
4. `platformLoadComponent("api", {host: <page origin>, token})`.
5. `window.thingConnectCallback` registered (callbacks are global function
   *names* Pilot invokes), then `platformLoadComponent("thing", {host:
   mqtt_addr, username, password, connectCallback:
   "thingConnectCallback"})`.
6. `platformSetWorkspaceId(workspace_id)` +
   `platformSetInformation(platform_name, workspace_name, workspace_desc)`.
7. One-shot `thingGetConnectState()` to catch an already-attached link;
   afterwards the callback drives the MQTT row on the status panel.
8. `platformLoadComponent("media", {autoUploadPhoto: true,
   autoUploadPhotoType: 0, autoUploadVideo: true})` — originals (not
   thumbnails) + video auto-upload on, per the media-return design
   (`mediaSetAutoUploadVideo` is covered by the load param).

Bridge return parsing (`parseBridgeReturn`): string returns are JSON
`{code, message, data}` envelopes — `code: 0` = ok, `data` is sometimes a
JSON-encoded string itself (`"true"`/`"false"`); plain `true`/`false` and
void returns also occur (void = success, no error signal). An envelope with
`code: 0` but `data: false` counts as failure.

Without `window.djiBridge` (plain browser) the page degrades to an "open
this page in DJI Pilot 2" banner — also how the node-driven tests exercise
the flow (`fieldhub/tests/test_pilot_page.py`).

Not yet loaded: `mission`, `tsa`, `ws`. Pilot syncs the wayline list over
HTTP (§3.2) via the `api` module; whether the route library additionally
requires the `mission` component is ⚠ UNVERIFIED on hardware — add it to
the sequence when the RC verdict lands. Parameter dictionary for the unused
modules: demo `front_page/src/api/pilot-bridge.ts` (archived in the spike
workspace).

## 6. Device enums (product dictionary)

`domain-type-subtype`; domain: 0 = aircraft, 1 = payload, 2 = RC, 3 = dock.

| device | key | status |
|---|---|---|
| Matrice 300 RTK | `0-60-0` | from demo SQL |
| Matrice 350 RTK | `0-89-0` | from demo SQL |
| Mavic 3 Enterprise (M3E) | `0-77-0` | from demo SQL |
| Mavic 3T | `0-77-1` | from demo SQL |
| Matrice 30 / 30T | `0-67-0` / `0-67-1` | from demo SQL |
| DJI RC Plus | `2-119-0` | from demo SQL |
| DJI RC Pro Enterprise | `2-144-0` | Cloud-API-Doc |
| **Matrice 4T** | `0-99-1` ⚠ UNVERIFIED | derived from WPML `droneEnumValue` 99 sub 1 (matches the pattern: M350=89, M300=60, M3E=77 are identical in WPML and the device dictionary) |
| **DJI RC Plus 2** | ⚠ UNKNOWN | capture from the live `update_topo` payload when the hardware arrives (V1/V2) |

These keys appear in `update_topo` payloads, wayline `drone_model_key`
filtering, and OSD routing — the hub must hold a device dictionary keyed by
them (seed from this table; unknown devices must degrade gracefully, not
crash binding).

## 7. Provisioning & field constraints

- **TLS**: Pilot requires the platform URL over HTTPS and the broker over
  MQTTS in production posture; the local CA from `gen-certs.sh` must be
  installed on each RC once (Android CA store or Pilot cert import — exact
  path is V5 ⚠). Cert SANs must include the laptop's LAN IP.
- **One-time online**: DJI app-license verification needs internet at least
  once per RC (V1 ⚠ — exact recheck cadence unknown). Field operation after
  provisioning must be fully offline.
- **NTP**: the demo configures an NTP server hint for devices
  (`ntp.server.host`); offline deployments should point it at the field
  laptop or omit it — flag for V1 testing.
- **Addressing**: every URL/address handed to Pilot (platform URL,
  `mqtt_addr`, STS `endpoint`, presigned URLs) must use the laptop's static
  LAN IP on the travel router; compose-internal hostnames must never leak
  into device-facing payloads.

## 8. Scope map for the implementation issues

| issue | implements from this doc |
|---|---|
| binding + link status | §1, §3.1, §3.4, §4 (status/update_topo, online/offline), §5, §6 |
| mission dispatch | §3.2 (list, url, duplicate-names, favorites), KMZ contract via `dji-wpml-reference.md` |
| media return | §3.3 (sts, fast-upload, tiny-fingerprints, upload-callback), §4 `storage_config_get` |
| explicitly out of scope v1 | livestream, DRC live control, HMS, firmware/OTA, log upload, map elements, dock-only flight-task execution |

## 9. Sources

- DJI Cloud API Demo v1.10 source (sample + cloud-sdk modules) — archived
  in the spike workspace on the field laptop; the structures named above
  (`UserDTO`, `GetWaylineListResponse`, `StsCredentialsResponse`,
  `MediaUploadCallbackRequest`, `MediaFileMetadata`, `CommonTopicRequest`,
  `TopicConst`, `HttpResultResponse`) carry the exact field sets.
- Public Cloud-API-Doc (github.com/dji-sdk/Cloud-API-Doc) for the Pilot
  feature-set narrative and product-support matrix.
- Live validation against the demo stack on the field laptop (login, MQTT
  broker, MinIO bucket + STS path) — 2026-06-09/10.
