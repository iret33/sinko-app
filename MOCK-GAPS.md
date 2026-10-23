# The development box: what it imitates, and what it does not

`npm run mock` runs Sinko's own mock Pi-hole (`../sinko/tests/mock_pihole.py --setup --web`, unchanged) behind a small proxy
(`mock/proxy.mts`). The proxy adds what the app needs and the mock leaves out. This file lists both: what the proxy adds, and what
neither of them does, so nobody mistakes a pass against the mock for a pass against a real box.

## Added by the proxy

| What | How | Dev endpoint |
|---|---|---|
| `Set-Cookie: sid=…` | On the sign-in answer and on every signed-in answer (`SameSite=Strict; Path=/; Max-Age=1800; HttpOnly`), deleted on sign-out, like FTL. A request with the cookie and no `sid` header is a cookie sign-in: reads work, anything else is `401` (no CSRF token). Every request that carries a cookie is counted and logged. | `GET /__dev__/status`, `GET /__dev__/cookie-probe` |
| Two-factor errors | With a code switched on: `400 {"error":{"message":"No 2FA token found in JSON payload"}}` when the code is missing, `401` with only `{"error":{"message":"Invalid 2FA token"}}` when it is wrong, and `session.totp: true` in the answers that carry a session. The mock answers both with a session object. | `POST /__dev__/totp {"code":"123456"}` / `{"code":null}` |
| Too many sessions | `429 api_seats_exceeded` for every sign-in while switched on. | `POST /__dev__/seats {"full":true}` |
| Devices that asked just now | Moves a device's `lastQuery` (by MAC or address, or all of them) to the box's now, minus `ago` seconds; adds devices to the network table. | `POST /__dev__/devices/touch {"hwaddr"?, "ip"?, "ago"?}`, `POST /__dev__/devices/add {"hwaddr","ip","name"?,"macVendor"?}` |
| `/api/info/client` | Answers any address (the mock always says `192.168.1.21`, a child's iPad). | `POST /__dev__/client {"ip":"192.168.1.9"}` / `{"ip":null}` |
| Timers and bedtime | `bin/sinko Controller.tick`: a timer that is over restores the rules saved with it, bedtime switches the internet off and on, on the box's wall clock (box.json's `utcOffset`, `+03:00`), every 5 s and on demand. | `POST /__dev__/tick`, `POST /__dev__/scheduler {"tickSeconds":…}` |
| Update and check requests | The request protocol (store the marker, clear it, act), 1 s after the app writes the state. Update: `ok`, `failed` (with `rolledBack` true, false or null and an `error`), `never` (never picked up), `hang` (running for ever), and seconds of silence while it installs. Check: finds the version on offer, or "the box is offline" (nothing changes). A successful update changes `/pb/version.txt` and box.json's `version`. | `POST /__dev__/scheduler {"latest":"3.2.0","update":{…},"check":{…}}` |
| Restart and shut down | Restart: the box stops answering for `restartSeconds` (25). Shut down: it stops answering until "plug back in". Either can sign every phone out (`endSessions`; off by default, because Pi-hole v6 restores its sessions after a restart). A request while an update runs is dropped, as `bin/sinko` does. The box can also "not react" (the request is never picked up). | `POST /__dev__/scheduler {"power":{…}}`, `POST /__dev__/power/plug-in`, `POST /__dev__/outage {"seconds":30}` |
| The box's clock | The `Date` header, box.json's `at` and the scheduler's clock can be skewed; box.json's heartbeat can be made late. | `POST /__dev__/clock {"skewSec":10800}`, `POST /__dev__/heartbeat {"ageSec":1500}` |
| The web server's caching | Files outside `/api/` answer `Cache-Control: max-age=3600` like Pi-hole's web server, and the proxy counts how many requests asked for a fresh copy. | `GET /__dev__/status` (`boxFiles`) |
| A new password | After a claim or a password change through the app, the proxy signs in with the new password to keep playing the scheduler. | |

A dev menu with buttons for all of this is at `http://127.0.0.1:8080/__dev__/`.

## Not imitated (by the mock or the proxy)

**Signing in and sessions**
- Sessions never expire and their `validity` never counts down; `GET /api/auth` with a session answers `sid: null`. There is no
  `/api/auth/sessions`, no application password and no CSRF token (`csrf` is `null`), so a cookie sign-in can never write.
- The two-factor code is a fixed six digits set in the dev menu, not a TOTP. A code that is not a number is treated as wrong (FTL's own
  answer for that case was not checked).
- No delay or lock-out after wrong passwords. "Too many sessions" is a switch, not a count of open sessions.

**The network and the box**
- http only: Pi-hole v6 also serves https on 443 with a self-signed certificate. No mDNS (`sinko.local`), no DNS: the app is pointed at an
  address. The mock listens on 127.0.0.1 only; the proxy can listen on every interface (`npm run mock -- --host 0.0.0.0`) for a real phone.
- One HTTP/1.0 answer per connection. Streamed answers (`POST /api/action/gravity`) are read whole by the proxy and passed on at once,
  and the mock's rebuild takes no time.
- No ETag or `304` on files, no Content-Security-Policy header (the mock has them only behind switches that have no HTTP endpoint).
- The skewed clock moves only the `Date` header, box.json and the scheduler: `lastQuery`, the query log, `/api/history` and the uptime stay
  on this computer's clock.

**DNS and filtering**
- Nothing is filtered. With `--live`, a child's query for an app is answered `GRAVITY` while that app's group is enabled, but the mock
  ignores client groups, `pb-offline`, `pb-paused` and the `^.*$` rule: an offline or paused child still shows normal traffic.
- `lastQuery` of a device never moves by itself, not even with `--live` traffic: only the dev endpoint moves it.
- Privacy levels, the hidden per-client history, failing `/api/info/*` calls, temperature, memory and the like are switches of the mock's
  `Store` with no HTTP endpoint, so they cannot be changed while it runs.

**The scheduler**
- Not run: learning new addresses (`Learner`), automatic updates at night, the daily check, the 5-minute gap between update runs, the
  self-check and repair, the address watch, the anonymous counter (`community` is never written) and box.json's own refresh (it is always
  fresh unless the dev menu makes it late).
- "A request is for now" (architecture.md): a marker more than 15 minutes away from the box's clock is acted on anyway.
- What was handled is kept in memory only, and a restart of the box does not restart anything: groups, sessions and the state survive it.

**Backups**
- The Teleporter archive is the mock's own (JSON tables in a zip), not FTL's (an SQLite database): a backup of a real box cannot be restored
  on the mock, nor the other way round.
