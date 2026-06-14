import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RefObject } from "react";
import type maplibregl from "maplibre-gl";
import MapViewportControls from "./MapViewportControls";
import {
  MAP_BEARING_RESET_DURATION_MS,
  MAP_ZOOM_TICK_DURATION_MS,
} from "@/constants/mapAnimations";

type MapStub = {
  getZoom: ReturnType<typeof vi.fn>;
  zoomTo: ReturnType<typeof vi.fn>;
  easeTo: ReturnType<typeof vi.fn>;
};

type CesiumStub = {
  isDestroyed: ReturnType<typeof vi.fn>;
  camera: {
    positionWC: { x: number; y: number; z: number };
    pitch: number;
    setView: ReturnType<typeof vi.fn>;
  };
};

function makeMapStub(zoom = 12): MapStub {
  return {
    getZoom: vi.fn().mockReturnValue(zoom),
    zoomTo: vi.fn(),
    easeTo: vi.fn(),
  };
}

function makeCesiumStub(): CesiumStub {
  return {
    isDestroyed: vi.fn().mockReturnValue(false),
    camera: {
      positionWC: { x: 1, y: 2, z: 3 },
      pitch: -0.5,
      setView: vi.fn(),
    },
  };
}

function refOf<T>(value: T): RefObject<T> {
  return { current: value } as RefObject<T>;
}

describe("MapViewportControls", () => {
  let mapStub: MapStub;
  let cesiumStub: CesiumStub;
  let mapRef: RefObject<maplibregl.Map | null>;
  let cesiumViewerRef: RefObject<import("cesium").Viewer | null>;

  beforeEach(() => {
    mapStub = makeMapStub();
    cesiumStub = makeCesiumStub();
    mapRef = refOf(mapStub as unknown as maplibregl.Map);
    cesiumViewerRef = refOf(cesiumStub as unknown as import("cesium").Viewer);
  });

  it("renders nothing when both showCompass and showZoomControls are false", () => {
    const { container } = render(
      <MapViewportControls
        mapRef={mapRef}
        cesiumViewerRef={cesiumViewerRef}
        is3D={false}
        bearing={0}
        showCompass={false}
        showZoomControls={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("applies inverse-bearing rotation to the compass dial", () => {
    render(
      <MapViewportControls
        mapRef={mapRef}
        cesiumViewerRef={cesiumViewerRef}
        is3D={false}
        bearing={45}
        showCompass={true}
        showZoomControls={false}
      />,
    );
    const dial = screen.getByTestId("compass-btn").querySelector("svg");
    expect(dial).not.toBeNull();
    expect(dial?.getAttribute("style") ?? "").toContain("rotate(-45deg)");
  });

  it("calls map.easeTo with reset bearing on compass click in 2D", () => {
    render(
      <MapViewportControls
        mapRef={mapRef}
        cesiumViewerRef={refOf<import("cesium").Viewer | null>(null)}
        is3D={false}
        bearing={90}
        showCompass={true}
        showZoomControls={false}
      />,
    );
    fireEvent.click(screen.getByTestId("compass-btn"));
    expect(mapStub.easeTo).toHaveBeenCalledWith({
      bearing: 0,
      duration: MAP_BEARING_RESET_DURATION_MS,
    });
  });

  it("calls cesium camera.setView with heading=0, roll=0 on compass click in 3D", () => {
    render(
      <MapViewportControls
        mapRef={mapRef}
        cesiumViewerRef={cesiumViewerRef}
        is3D={true}
        bearing={120}
        showCompass={true}
        showZoomControls={false}
      />,
    );
    fireEvent.click(screen.getByTestId("compass-btn"));
    expect(cesiumStub.camera.setView).toHaveBeenCalledWith({
      destination: cesiumStub.camera.positionWC,
      orientation: { heading: 0, pitch: cesiumStub.camera.pitch, roll: 0 },
    });
    expect(mapStub.easeTo).not.toHaveBeenCalled();
  });

  it("falls back to maplibre easeTo when 3D viewer is destroyed", () => {
    cesiumStub.isDestroyed.mockReturnValue(true);
    render(
      <MapViewportControls
        mapRef={mapRef}
        cesiumViewerRef={cesiumViewerRef}
        is3D={true}
        bearing={120}
        showCompass={true}
        showZoomControls={false}
      />,
    );
    fireEvent.click(screen.getByTestId("compass-btn"));
    expect(cesiumStub.camera.setView).not.toHaveBeenCalled();
    expect(mapStub.easeTo).toHaveBeenCalled();
  });

  it("zoom-in zooms by +1 with the tick duration", () => {
    render(
      <MapViewportControls
        mapRef={mapRef}
        cesiumViewerRef={cesiumViewerRef}
        is3D={false}
        bearing={0}
        showCompass={false}
        showZoomControls={true}
      />,
    );
    fireEvent.click(screen.getByTestId("zoom-in-btn"));
    expect(mapStub.zoomTo).toHaveBeenCalledWith(13, {
      duration: MAP_ZOOM_TICK_DURATION_MS,
    });
  });

  it("zoom-out zooms by -1 with the tick duration", () => {
    render(
      <MapViewportControls
        mapRef={mapRef}
        cesiumViewerRef={cesiumViewerRef}
        is3D={false}
        bearing={0}
        showCompass={false}
        showZoomControls={true}
      />,
    );
    fireEvent.click(screen.getByTestId("zoom-out-btn"));
    expect(mapStub.zoomTo).toHaveBeenCalledWith(11, {
      duration: MAP_ZOOM_TICK_DURATION_MS,
    });
  });

  it("does not throw when mapRef.current is null and zoom buttons are clicked", () => {
    render(
      <MapViewportControls
        mapRef={refOf<maplibregl.Map | null>(null)}
        cesiumViewerRef={cesiumViewerRef}
        is3D={false}
        bearing={0}
        showCompass={true}
        showZoomControls={true}
      />,
    );
    expect(() => fireEvent.click(screen.getByTestId("zoom-in-btn"))).not.toThrow();
    expect(() => fireEvent.click(screen.getByTestId("zoom-out-btn"))).not.toThrow();
    expect(() => fireEvent.click(screen.getByTestId("compass-btn"))).not.toThrow();
  });
});
