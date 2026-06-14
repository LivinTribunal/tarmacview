# contexts package (frontend)

## Purpose

React context providers for cross-page shared state - auth, the active airport/mission, theme, the running trajectory compute, and the system-settings snapshot. Four providers wrap `<App />` in `main.tsx`; `MissionProvider` and `ComputationProvider` mount inside `OperatorLayout`. Consumers read state via the matching `useX` hook.

## Public API surface

- `AuthContext` — `AuthProvider` + `useAuth()`. Holds `user`, `accessToken`, `login()`, `logout()`, `refreshUser()`, `isAuthenticated`, `isLoading`. Wires `tokenStore` so the axios client picks up the bearer through a side-channel. Re-exports the `AuthUser` type. `refreshUser()` re-fetches `GET /auth/me` and replaces the cached `user`; call it after any mutation that changes the user's own profile (e.g. the Account Settings name update) so the navbar reflects the new value without a remount.
- `AirportContext` — `AirportProvider` + `useAirport()`. Holds `selectedAirport`, the lazily-fetched `airportDetail`, `selectAirport()`, `clearAirport()`, `refreshAirportDetail()`. Synchronously hydrates from `localStorage.tarmacview_airport` on first render so route gates don't see a transient null on reload.
- `MissionContext` — `MissionProvider` + `useMission()`. Holds `missions`, `selectedMission`, `refreshMissions()`, `refreshSelectedMission()`, `updateMissionInList()`, `setSelectedMission()`, `clearMission()`. Reads `useAirport()` and resets when the selected airport changes.
- `ComputationContext` — `ComputationProvider` + `useComputation()`. Owns the polling state machine (`IDLE` → `COMPUTING` → `COMPLETED` / `FAILED`, mirroring the backend `ComputationStatus` enum) for `POST /missions/{id}/generate-trajectory`. Persists in-flight state to `sessionStorage.tarmacview_computation` so a refresh mid-compute keeps polling. All terminal transitions funnel through one internal `applyTerminalStatus(status, patch)` helper (the promise resolve/reject, the session-reconcile effect, and the poll loop) so the refresh + auto-dismiss behavior stays identical across all three call sites.
- `ThemeContext` — `ThemeProvider` + `useTheme()`. Two-value `theme: "light" | "dark"` toggled via `toggleTheme()`; persisted in `localStorage.tarmacview_theme`. Side-effects `document.documentElement.classList`.
- `SystemSettingsContext` — `SystemSettingsProvider` + `useSystemSettings()`. Shared cache of `GET /admin/system-settings` (`maintenance_mode`, `cesium_ion_token`, and the elevation API config - provider, url, key, fallback flag); exposes `settings`, `loading`, `refresh()`. Consumed by `NavBar` (maintenance-mode flag), `TerrainSettingsCard` (elevation fallback flag), and `SuperAdminSystemPage` (`refresh()` only - the form keeps its own local copy).

## Invariants

- **Provider order in `main.tsx` is load-bearing.** `ThemeProvider` → `AuthProvider` → `SystemSettingsProvider` → `AirportProvider` → `<App />`. `SystemSettingsContext` reads `useAuth()` so it must sit inside `AuthProvider`; `AirportContext` reads neither so its position is flexible, but pages assume it's already mounted. Same deal in `OperatorLayout`: `ComputationProvider` reads `useMission()` so it must nest inside `MissionProvider`.
- **Each hook throws if used outside its provider.** Don't silently `return null` — a missing provider is a wiring bug, not a runtime state.
- **`useSystemSettings` does not poll.** Fetch fires on mount and whenever `isAuthenticated` flips; a super-admin toggle made from another browser session is not reflected until next mount, auth flip, or explicit `refresh()` call. `SuperAdminSystemPage` calls `refresh()` after a successful PUT so the admin who flipped sees their own change.
- **Persistence keys are namespaced under `tarmacview_*`** (`tarmacview_airport`, `tarmacview_mission`, `tarmacview_theme`, `tarmacview_computation`). Don't collide.
- **Contexts only call functions from `@/api/*`** — never axios directly, so the JWT interceptor and 401-refresh flow stay intact.
- **Memoize the context `value` with `useMemo`.** Five of the six providers do (`const value = useMemo(...)` then `<Provider value={value}>`); `ComputationProvider` is the standing exception - it rebuilds its value object every render, so don't cite it as precedent. Never build an object/array literal straight into the `value={...}` prop. An unmemoized value hands every consumer a fresh reference on each provider render and re-renders the whole subtree (the `jsx-no-constructed-context-values` regression). Keep the memo deps honest so it still recomputes when the exposed state changes.

## Cross-package dependencies

- Imports from: `react`, `react-router` (v7 - `react-router-dom` is no longer a dependency, import from `react-router`), `@/api/*` (admin, airports, missions), `@/auth/tokenStore`, `@/types/*`.
- Imported by: `frontend/src/main.tsx` (provider mount), `frontend/src/pages/**`, `frontend/src/components/**`, `frontend/src/hooks/**`. The router itself does not consume contexts directly — pages do.

## Gotchas

- **`SystemSettingsContext` swallows 403/401 silently.** Non-privileged users used to get a 403; the GET is now open to any authenticated user, but `catch {}` is kept so a stale token or transient failure does not toss the previous `settings` value. If you need to surface errors, plumb them through `loading` first.
- **The GET blanks admin-only fields for non-super-admin callers.** The backend returns `cesium_ion_token` and `elevation_api_url` as `""` and `elevation_api_key` as `null` unless the caller is a super admin; only `maintenance_mode`, `elevation_api_provider`, and `elevation_api_fallback_enabled` are populated for every role. Don't read secrets out of this context on operator/coordinator pages - and the 3D viewer's Ion token does not come from here at all, it is `VITE_CESIUM_ION_TOKEN` read at build time.
- **`AirportContext` validates the shape of the localStorage payload** before accepting it (id/icao_code/name/elevation/location.coordinates). Schema drift on `AirportResponse` requires a matching update to `readAirportFromStorage` or the hydration silently drops the saved airport on next load.
- **`MissionContext` resets to empty when `selectedAirport` changes.** A page that holds a stale `mission_id` after an airport switch will fail to find the row — listen for the reset rather than assuming the list is stable.
- **`ComputationContext` is the only place that calls `getComputationStatus`.** Pages should subscribe via `useComputation()` and read `status` / `lastResult`; don't re-poll directly or the two polls will race and the UI will flicker between states.
- **`applyTerminalStatus` ordering is load-bearing, don't "tidy" it.** It calls `setState` *before* the `if (!mountedRef.current) return` guard so the final state is always committed even if the provider unmounted between the network resolve and the callback; only the post-state side-effects (refresh + `scheduleDismiss`) are skipped on unmount. The `IDLE` terminal does no refresh and no dismiss (it's the abort / stale-session path). The poll loop's *network-error* branch is deliberately left inline (`setState` FAILED + `scheduleDismiss`, no `refreshMissions` / `refreshSelectedMission`) rather than routed through the helper, because a transport failure shouldn't trigger a mission refetch — keep it inline so the refresh call counts stay unchanged.
