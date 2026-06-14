import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CoordinateInput from "./CoordinateInput";
import type { PointZ } from "@/types/common";

// bounds-error rendering and the simple lat commit are owned by
// MissionConfigPage.test.tsx - here we cover the partial-string blur reset,
// the commit gate, the defaultAltitude fallback, and external prop sync

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const POINT: PointZ = { type: "Point", coordinates: [17.21, 48.17, 133] };

function driveRawValue(input: HTMLInputElement, raw: string) {
  /** drive a partial string like "-" into a number input. jsdom's value setter
   * sanitizes invalid floats to "", so shadow the instance accessor with a
   * pass-through seeded with the raw string, then dispatch a bare change event
   * (a target.value would route through the sanitizing prototype setter). */
  let current = raw;
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => current,
    set: (v) => {
      current = String(v);
    },
  });
  fireEvent.change(input);
}

describe("CoordinateInput partial-string blur reset", () => {
  it("resets a lone '-' on blur and commits null when all fields are empty", () => {
    const onChange = vi.fn();
    render(<CoordinateInput label="Takeoff" value={null} onChange={onChange} />);
    const lat = screen.getByTestId("takeoff-lat") as HTMLInputElement;

    driveRawValue(lat, "-");
    expect(lat.value).toBe("-");
    // a partial entry is never committed
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(lat);
    expect(lat.value).toBe("");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("re-commits the surviving fields when a partial is reset on blur", () => {
    const onChange = vi.fn();
    render(<CoordinateInput label="Takeoff" value={POINT} onChange={onChange} />);
    const lat = screen.getByTestId("takeoff-lat") as HTMLInputElement;

    driveRawValue(lat, "-");
    expect(onChange).not.toHaveBeenCalled();

    // the cleared lat falls back to the previous committed value
    fireEvent.blur(lat);
    expect(onChange).toHaveBeenCalledWith(POINT);
  });

  it("rejects unparseable partials like '.' at the keystroke guard", () => {
    const onChange = vi.fn();
    render(<CoordinateInput label="Takeoff" value={null} onChange={onChange} />);
    const lat = screen.getByTestId("takeoff-lat") as HTMLInputElement;

    driveRawValue(lat, ".");
    // react restores the rejected keystroke back to the empty controlled value
    expect(lat.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("CoordinateInput commit gate", () => {
  it("commits null only when all three fields are cleared", () => {
    const onChange = vi.fn();
    render(<CoordinateInput label="Takeoff" value={POINT} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("takeoff-lat"), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalledWith(null);
    // a cleared field re-commits with its previous value while others remain
    expect(onChange).toHaveBeenLastCalledWith(POINT);

    fireEvent.change(screen.getByTestId("takeoff-lon"), { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalledWith(null);

    fireEvent.change(screen.getByTestId("takeoff-alt"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("falls back to defaultAltitude when committing from a null value", () => {
    const onChange = vi.fn();
    render(
      <CoordinateInput
        label="Landing"
        value={null}
        onChange={onChange}
        defaultAltitude={133}
      />,
    );

    fireEvent.change(screen.getByTestId("landing-lat"), {
      target: { value: "48.5" },
    });
    expect(onChange).toHaveBeenCalledWith({
      type: "Point",
      coordinates: [0, 48.5, 133],
    });
  });
});

describe("CoordinateInput external prop sync", () => {
  it("re-syncs all three strings when the external value changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CoordinateInput label="Takeoff" value={null} onChange={onChange} />,
    );
    expect((screen.getByTestId("takeoff-lat") as HTMLInputElement).value).toBe("");

    // e.g. pick-on-map pushes a new value from outside
    rerender(<CoordinateInput label="Takeoff" value={POINT} onChange={onChange} />);
    expect((screen.getByTestId("takeoff-lat") as HTMLInputElement).value).toBe("48.17");
    expect((screen.getByTestId("takeoff-lon") as HTMLInputElement).value).toBe("17.21");
    expect((screen.getByTestId("takeoff-alt") as HTMLInputElement).value).toBe("133");

    rerender(<CoordinateInput label="Takeoff" value={null} onChange={onChange} />);
    expect((screen.getByTestId("takeoff-lat") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("takeoff-lon") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("takeoff-alt") as HTMLInputElement).value).toBe("");
  });
});
