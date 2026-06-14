import { describe, expect, it, vi } from "vitest";
import * as iconFactories from "./iconFactories";

describe("iconFactories module surface", () => {
  it("exports every icon factory the orchestrator registers", () => {
    // mapImages.ts registers the icons in registerAllMapImages; these are the
    // factories it imports. if any goes missing the sprite table breaks
    // silently at runtime (icon-image: 'agl-square' would render blank).
    const expected = [
      "createTriangleIcon",
      "createRoundedSquareIcon",
      "createHoverIcon",
      "createRecordingStartIcon",
      "createRecordingStopIcon",
      "createTowerIcon",
      "createAntennaIcon",
      "createTreeIcon",
      "createHatchPattern",
      "createAglSquareIcon",
      "createPathArrowIcon",
      "createThresholdIcon",
      "createEndPositionIcon",
    ];
    for (const name of expected) {
      expect(typeof (iconFactories as unknown as Record<string, unknown>)[name]).toBe("function");
    }
  });
});

describe("registerAllMapImages sprite table", () => {
  it("registers the canonical sprite names with pixelRatio=2", async () => {
    // canvas 2D context is unavailable in jsdom, so stub it to a no-op that
    // returns a minimal ImageData. this confirms the orchestrator wires every
    // sprite through with the expected name + pixelRatio without painting.
    const stubCtx: Partial<CanvasRenderingContext2D> = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      roundRect: vi.fn(),
      // jsdom lacks ImageData; return an object that quacks the same shape
      getImageData: vi.fn(() => ({ width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) })) as unknown as CanvasRenderingContext2D["getImageData"],
    };
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => stubCtx) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    try {
      const { registerAllMapImages } = await import("../mapImages");
      const addImage = vi.fn();
      const hasImage = vi.fn().mockReturnValue(false);
      const map = { addImage, hasImage } as unknown as import("maplibre-gl").Map;

      registerAllMapImages(map);

      // every named sprite addImage call uses pixelRatio: 2
      const names = addImage.mock.calls.map((c) => c[0]);
      expect(names).toContain("obstacle-building");
      expect(names).toContain("obstacle-tower");
      expect(names).toContain("obstacle-antenna");
      expect(names).toContain("obstacle-vegetation");
      expect(names).toContain("obstacle-other");
      expect(names).toContain("takeoff-square");
      expect(names).toContain("landing-square");
      expect(names).toContain("hover-icon");
      expect(names).toContain("recording-start-icon");
      expect(names).toContain("recording-stop-icon");
      expect(names).toContain("agl-square");
      expect(names).toContain("path-arrow");
      expect(names).toContain("threshold-marker");
      expect(names).toContain("end-position-marker");

      for (const call of addImage.mock.calls) {
        expect(call[2]).toEqual({ pixelRatio: 2 });
      }
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });
});
