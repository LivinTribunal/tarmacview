import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AnnotatedVideoPlayer from "./AnnotatedVideoPlayer";

describe("AnnotatedVideoPlayer", () => {
  it("stretches the video to fill its container", () => {
    render(
      <AnnotatedVideoPlayer
        videoUrls={{ all_papi_lights: "blob:combined", PAPI_A: "blob:a" }}
      />,
    );
    const video = screen.getByTestId("annotated-video-element");
    expect(video).toHaveClass("object-fill");
    expect(video).not.toHaveClass("object-contain");
  });

  it("renders the empty state when there are no tracks", () => {
    render(<AnnotatedVideoPlayer videoUrls={{}} />);
    expect(screen.queryByTestId("annotated-video-element")).toBeNull();
  });
});
