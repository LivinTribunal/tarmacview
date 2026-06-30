import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RenameModal from "./RenameModal";

function setup(over: Partial<React.ComponentProps<typeof RenameModal>> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    title: "Rename",
    value: "alpha",
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    placeholder: "name",
    inputId: "rn",
    inputTestId: "rn-input",
    ...over,
  };
  render(<RenameModal {...props} />);
  return props;
}

describe("RenameModal", () => {
  it("renders the input and fires onSubmit on form submit", () => {
    const props = setup();
    const input = screen.getByTestId("rn-input");
    expect(input).toHaveValue("alpha");
    fireEvent.submit(input.closest("form")!);
    expect(props.onSubmit).toHaveBeenCalledOnce();
  });

  it("disables save on empty value when submitDisabledWhenEmpty is set", () => {
    setup({ value: "  ", submitDisabledWhenEmpty: true });
    expect(screen.getByText("common.save")).toBeDisabled();
  });

  it("keeps save enabled on empty value otherwise", () => {
    setup({ value: "" });
    expect(screen.getByText("common.save")).not.toBeDisabled();
  });
});
