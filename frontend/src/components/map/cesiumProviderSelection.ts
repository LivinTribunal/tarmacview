/** pick cesium terrain/imagery providers from build-time env vars.
 *
 * keeps cesium scene init free of env-var branching so the selection logic is
 * unit-testable without booting a viewer.
 */

export type CesiumTerrainConfig =
  | { kind: "ion" }
  | { kind: "url"; url: string };

export type CesiumImageryConfig =
  | { kind: "ion" }
  | { kind: "url"; url: string };

/** read VITE_CESIUM_TERRAIN_URL and decide between ion world terrain and a custom url. */
export function pickTerrainConfig(url: string | undefined): CesiumTerrainConfig {
  if (url && url.length > 0) {
    return { kind: "url", url };
  }
  return { kind: "ion" };
}

/** read VITE_CESIUM_IMAGERY_URL and decide between ion satellite imagery and a custom url. */
export function pickImageryConfig(url: string | undefined): CesiumImageryConfig {
  if (url && url.length > 0) {
    return { kind: "url", url };
  }
  return { kind: "ion" };
}
