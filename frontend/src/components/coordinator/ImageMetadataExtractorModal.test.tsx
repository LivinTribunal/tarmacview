import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ImageMetadataExtractorModal, {
  type ExtractorHandoff,
} from "./ImageMetadataExtractorModal";
import type { PhotoMetadataItem, PhotoMetadataResponse } from "@/types/airport";

// keep the dialog off the network
vi.mock("@/api/airports", () => ({
  extractPhotoMetadata: vi.fn(),
}));

import { extractPhotoMetadata } from "@/api/airports";

const mockExtract = extractPhotoMetadata as unknown as ReturnType<typeof vi.fn>;

function geoItem(
  filename: string,
  lon: number,
  lat: number,
  alt = 100,
  overrides: Partial<PhotoMetadataItem> = {},
): PhotoMetadataItem {
  /** build a geotagged metadata item fixture. */
  return {
    filename,
    coordinates: { type: "Point", coordinates: [lon, lat, alt] },
    lens_height_msl_m: null,
    lens_height_agl_m: null,
    error: null,
    ...overrides,
  };
}

function noGpsItem(filename: string): PhotoMetadataItem {
  /** build a metadata item with no GPS data. */
  return { filename, coordinates: null, lens_height_msl_m: null, lens_height_agl_m: null, error: null };
}

function resp(items: PhotoMetadataItem[], has_dem = false): PhotoMetadataResponse {
  /** wrap items into a metadata response. */
  return { items, has_dem };
}

function makeFiles(n: number): File[] {
  /** build n dummy image files for the picker. */
  return Array.from({ length: n }, (_, i) => new File(["x"], `photo${i}.jpg`, { type: "image/jpeg" }));
}

async function uploadAndWait(items: PhotoMetadataItem[], has_dem = false) {
  /** fire the file picker and wait for the review list to render. */
  mockExtract.mockResolvedValueOnce(resp(items, has_dem));
  const input = screen.getByTestId("image-extractor-input");
  fireEvent.change(input, { target: { files: makeFiles(items.length) } });
  await waitFor(() => expect(screen.getByTestId("image-extractor-review")).toBeInTheDocument());
}

function renderModal(onHandoff = vi.fn(), onClose = vi.fn()) {
  /** render the dialog open with stub callbacks. */
  render(
    <ImageMetadataExtractorModal
      isOpen
      onClose={onClose}
      airportId="airport-1"
      onHandoff={onHandoff}
    />,
  );
  return { onHandoff, onClose };
}

describe("ImageMetadataExtractorModal", () => {
  beforeEach(() => {
    mockExtract.mockReset();
  });

  it("offers AGL and AGL-Unit targets for a single geotagged image", async () => {
    renderModal();
    await uploadAndWait([geoItem("a.jpg", 17.1, 48.1)]);

    const select = screen.getByTestId("image-extractor-target");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "coordinator.imageExtractor.targets.agl",
      "coordinator.imageExtractor.targets.aglUnit",
    ]);
  });

  it("offers a single AGL-Units target for two images", async () => {
    renderModal();
    await uploadAndWait([geoItem("a.jpg", 17.1, 48.1), geoItem("b.jpg", 17.2, 48.2)]);

    const select = screen.getByTestId("image-extractor-target");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "coordinator.imageExtractor.targets.aglUnits",
    ]);
  });

  it("offers AGL-Units and Obstacle for three images", async () => {
    renderModal();
    await uploadAndWait([
      geoItem("a.jpg", 17.1, 48.1),
      geoItem("b.jpg", 17.2, 48.2),
      geoItem("c.jpg", 17.15, 48.25),
    ]);

    const select = screen.getByTestId("image-extractor-target");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("coordinator.imageExtractor.targets.aglUnits");
    expect(options).toContain("coordinator.imageExtractor.targets.obstacle");
  });

  it("offers Surface, Obstacle, AGL-Units for four or more images", async () => {
    renderModal();
    await uploadAndWait([
      geoItem("a.jpg", 17.1, 48.1),
      geoItem("b.jpg", 17.2, 48.2),
      geoItem("c.jpg", 17.15, 48.25),
      geoItem("d.jpg", 17.05, 48.15),
    ]);

    const select = screen.getByTestId("image-extractor-target");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "coordinator.imageExtractor.targets.surface",
      "coordinator.imageExtractor.targets.obstacle",
      "coordinator.imageExtractor.targets.aglUnits",
    ]);
  });

  it("reports a no-GPS image without dropping it from the review list", async () => {
    renderModal();
    await uploadAndWait([geoItem("a.jpg", 17.1, 48.1), noGpsItem("b.jpg")]);

    // both images appear in the review list
    expect(screen.getAllByTestId("image-extractor-item")).toHaveLength(2);
    // the no-GPS one is flagged
    expect(screen.getByTestId("image-extractor-nogps")).toBeInTheDocument();
    // only the one geotagged point drives the target options (n=1 -> agl, aglUnit)
    const select = screen.getByTestId("image-extractor-target");
    expect(within(select).getAllByRole("option")).toHaveLength(2);
  });

  it("hands off a single point with the AGL entity hint on confirm", async () => {
    const onHandoff = vi.fn<(h: ExtractorHandoff) => void>();
    const onClose = vi.fn();
    renderModal(onHandoff, onClose);
    await uploadAndWait([geoItem("a.jpg", 17.1, 48.1, 123)]);

    fireEvent.click(screen.getByText("coordinator.imageExtractor.confirm"));

    expect(onHandoff).toHaveBeenCalledTimes(1);
    const handoff = onHandoff.mock.calls[0][0];
    expect(handoff).toMatchObject({
      kind: "point",
      position: [17.1, 48.1],
      entityType: "agl",
    });
    // non-lha point carries no lens heights
    expect((handoff as { lens?: unknown }).lens).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it("carries lens heights when handing off an AGL-Unit point", async () => {
    const onHandoff = vi.fn<(h: ExtractorHandoff) => void>();
    renderModal(onHandoff);
    await uploadAndWait([
      geoItem("a.jpg", 17.1, 48.1, 200, { lens_height_msl_m: 200, lens_height_agl_m: 15 }),
    ]);

    // switch to the AGL-Unit (lha) target
    fireEvent.change(screen.getByTestId("image-extractor-target"), { target: { value: "lha" } });
    fireEvent.click(screen.getByText("coordinator.imageExtractor.confirm"));

    const handoff = onHandoff.mock.calls[0][0];
    expect(handoff).toMatchObject({
      kind: "point",
      entityType: "lha",
      lens: { msl: 200, agl: 15 },
    });
  });

  it("hands off all points with per-point lens for the AGL-Units target", async () => {
    const onHandoff = vi.fn<(h: ExtractorHandoff) => void>();
    renderModal(onHandoff);
    await uploadAndWait([
      geoItem("a.jpg", 17.1, 48.1, 100, { lens_height_msl_m: 100, lens_height_agl_m: 5 }),
      geoItem("b.jpg", 17.2, 48.2, 110, { lens_height_msl_m: 110, lens_height_agl_m: 6 }),
    ]);

    fireEvent.click(screen.getByText("coordinator.imageExtractor.confirm"));

    const handoff = onHandoff.mock.calls[0][0];
    expect(handoff).toMatchObject({
      kind: "points",
      entityType: "lha",
      positions: [
        [17.1, 48.1],
        [17.2, 48.2],
      ],
      lensPerPoint: [
        { msl: 100, agl: 5 },
        { msl: 110, agl: 6 },
      ],
    });
  });

  it("shows the vertex reorder list and reflects a manual swap for polygon targets", async () => {
    const onHandoff = vi.fn<(h: ExtractorHandoff) => void>();
    renderModal(onHandoff);
    await uploadAndWait([
      geoItem("a.jpg", 17.1, 48.1),
      geoItem("b.jpg", 17.2, 48.2),
      geoItem("c.jpg", 17.15, 48.25),
    ]);

    // choose the polygon (obstacle) target
    fireEvent.change(screen.getByTestId("image-extractor-target"), { target: { value: "obstacle" } });
    const orderPanel = await screen.findByTestId("image-extractor-vertex-order");
    expect(orderPanel).toBeInTheDocument();

    // strip the positional "N. " prefix so we compare filenames, which move
    const filenames = () =>
      within(orderPanel)
        .getAllByText(/\.jpg$/)
        .map((el) => (el.textContent ?? "").replace(/^\d+\.\s*/, ""));

    const before = filenames();
    expect(before).toEqual(["a.jpg", "b.jpg", "c.jpg"]);

    // move the first vertex down one slot
    fireEvent.click(screen.getByTestId("image-extractor-move-down-0"));

    // first two entries swap
    expect(filenames()).toEqual(["b.jpg", "a.jpg", "c.jpg"]);

    fireEvent.click(screen.getByText("coordinator.imageExtractor.confirm"));
    const handoff = onHandoff.mock.calls[0][0];
    expect(handoff.kind).toBe("polygon");
    if (handoff.kind === "polygon") {
      const ring = handoff.polygon.coordinates[0];
      // closed ring: first vertex repeated, 3 distinct + 1 closing = 4
      expect(ring.length).toBe(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  it("disables confirm until at least one geotagged point exists", async () => {
    renderModal();
    await uploadAndWait([noGpsItem("a.jpg")]);

    expect(screen.getByTestId("image-extractor-no-points")).toBeInTheDocument();
    const confirm = screen.getByText("coordinator.imageExtractor.confirm").closest("button")!;
    expect(confirm).toBeDisabled();
  });

  it("surfaces an error when extraction fails", async () => {
    renderModal();
    mockExtract.mockRejectedValueOnce(new Error("boom"));
    fireEvent.change(screen.getByTestId("image-extractor-input"), {
      target: { files: makeFiles(1) },
    });
    await waitFor(() =>
      expect(screen.getByText("coordinator.imageExtractor.extractError")).toBeInTheDocument(),
    );
  });

  it("surfaces an access-specific message on a 403, not the generic extract error", async () => {
    renderModal();
    mockExtract.mockRejectedValueOnce({ isAxiosError: true, response: { status: 403 } });
    fireEvent.change(screen.getByTestId("image-extractor-input"), {
      target: { files: makeFiles(1) },
    });
    await waitFor(() =>
      expect(screen.getByText("coordinator.imageExtractor.noAccess")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("coordinator.imageExtractor.extractError"),
    ).not.toBeInTheDocument();
  });
});
