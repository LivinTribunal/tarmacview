import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ModelSelectorOverlay from "./ModelSelectorOverlay";
import { BUNDLED_DRONE_MODELS } from "@/config/droneModels";

const FIRST = BUNDLED_DRONE_MODELS[0];

describe("ModelSelectorOverlay", () => {
  it("opens and closes the dropdown on trigger click", () => {
    render(
      <ModelSelectorOverlay
        selectedModelId={null}
        onSelectModel={vi.fn()}
        onRemoveModel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId(`model-option-${FIRST.id}`)).toBeNull();
    fireEvent.click(screen.getByTestId("model-dropdown-trigger"));
    expect(
      screen.getByTestId(`model-option-${FIRST.id}`),
    ).toBeInTheDocument();
  });

  it("calls onSelectModel with the chosen model id", () => {
    const onSelectModel = vi.fn();
    render(
      <ModelSelectorOverlay
        selectedModelId={null}
        onSelectModel={onSelectModel}
        onRemoveModel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("model-dropdown-trigger"));
    fireEvent.click(screen.getByTestId(`model-option-${FIRST.id}`));
    expect(onSelectModel).toHaveBeenCalledWith(FIRST.id);
  });

  it("shows the remove option only when a model is selected", () => {
    const onRemoveModel = vi.fn();
    render(
      <ModelSelectorOverlay
        selectedModelId={FIRST.id}
        onSelectModel={vi.fn()}
        onRemoveModel={onRemoveModel}
      />,
    );
    fireEvent.click(screen.getByTestId("model-dropdown-trigger"));
    fireEvent.click(screen.getByTestId("remove-model-option"));
    expect(onRemoveModel).toHaveBeenCalled();
  });

  it("rejects a non-glb/gltf file via onInvalidFile", () => {
    const onInvalidFile = vi.fn();
    const onUploadCustom = vi.fn();
    render(
      <ModelSelectorOverlay
        selectedModelId={null}
        onSelectModel={vi.fn()}
        onRemoveModel={vi.fn()}
        onUploadCustom={onUploadCustom}
        onInvalidFile={onInvalidFile}
      />,
    );
    const input = screen.getByTestId("model-file-input");
    fireEvent.change(input, {
      target: { files: [new File(["x"], "model.txt")] },
    });
    expect(onInvalidFile).toHaveBeenCalledWith("drone.invalidFileType");
    expect(onUploadCustom).not.toHaveBeenCalled();
  });

  it("accepts a glb file via onUploadCustom", () => {
    const onUploadCustom = vi.fn();
    render(
      <ModelSelectorOverlay
        selectedModelId={null}
        onSelectModel={vi.fn()}
        onRemoveModel={vi.fn()}
        onUploadCustom={onUploadCustom}
      />,
    );
    const input = screen.getByTestId("model-file-input");
    fireEvent.change(input, {
      target: { files: [new File(["x"], "model.glb")] },
    });
    expect(onUploadCustom).toHaveBeenCalled();
  });
});
