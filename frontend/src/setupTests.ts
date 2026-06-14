import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// node 22+ exposes a built-in localStorage that lacks clear(), overriding jsdom's
// provide a spec-compliant shim so tests can call localStorage.clear()
if (typeof localStorage !== "undefined" && typeof localStorage.clear !== "function") {
  const store: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, writable: true });
}

// real react-i18next returns a referentially-stable t across renders; keep the
// mock stable too so effects that (correctly) list t as a dep don't re-fire every render
const stableT = (key: string) => key;
const stableI18n = {
  language: "en",
  changeLanguage: vi.fn(),
  options: { resources: { en: {} } },
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/i18n", () => ({}));

// mock maplibre-gl globally - jsdom lacks WebGL and URL.createObjectURL
vi.mock("maplibre-gl", () => {
  const MockMap = vi.fn().mockImplementation(function () {
    return {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      remove: vi.fn(),
      addControl: vi.fn(),
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getLayer: vi.fn().mockReturnValue(null),
      setLayoutProperty: vi.fn(),
      setStyle: vi.fn(),
      getCenter: vi.fn().mockReturnValue({ lng: 0, lat: 0 }),
      getZoom: vi.fn().mockReturnValue(14),
      getBearing: vi.fn().mockReturnValue(0),
      getPitch: vi.fn().mockReturnValue(0),
      setCenter: vi.fn(),
      setZoom: vi.fn(),
      setBearing: vi.fn(),
      setPitch: vi.fn(),
      isStyleLoaded: vi.fn().mockReturnValue(false),
      queryRenderedFeatures: vi.fn().mockReturnValue([]),
      panBy: vi.fn(),
      zoomTo: vi.fn(),
    };
  });
  const MockNavigationControl = vi.fn();
  return {
    default: { Map: MockMap, NavigationControl: MockNavigationControl },
    Map: MockMap,
    NavigationControl: MockNavigationControl,
  };
});

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
