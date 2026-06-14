import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import InfrastructureListPanel from "./InfrastructureListPanel";

interface Item {
  id: string;
  name: string;
}

function renderPanel(opts: {
  onEdit: (item: Item) => void;
  onLocate?: (item: Item) => void;
  items?: Item[];
}) {
  /** render the panel with a single test item by default. */
  const items = opts.items ?? [{ id: "x", name: "Item X" }];
  return render(
    <InfrastructureListPanel<Item>
      title="Stuff"
      items={items}
      getId={(i) => i.id}
      getName={(i) => i.name}
      renderItem={(i) => <span>{i.name}</span>}
      onEdit={opts.onEdit}
      onLocate={opts.onLocate}
      onDelete={vi.fn()}
      addLabel="add"
    />,
  );
}

describe("InfrastructureListPanel click behavior", () => {
  it("single-click calls onEdit and does NOT call onLocate", () => {
    const onEdit = vi.fn();
    const onLocate = vi.fn();
    renderPanel({ onEdit, onLocate });

    const row = screen.getByTestId("infra-item-x");
    fireEvent.click(row);

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith({ id: "x", name: "Item X" });
    expect(onLocate).not.toHaveBeenCalled();
  });

  it("double-click invokes onLocate", () => {
    const onEdit = vi.fn();
    const onLocate = vi.fn();
    renderPanel({ onEdit, onLocate });

    const row = screen.getByTestId("infra-item-x");
    fireEvent.doubleClick(row);

    expect(onLocate).toHaveBeenCalledTimes(1);
    expect(onLocate).toHaveBeenCalledWith({ id: "x", name: "Item X" });
  });

  it("skips the second click of a double-click so onEdit does not fire twice", () => {
    const onEdit = vi.fn();
    const onLocate = vi.fn();
    renderPanel({ onEdit, onLocate });

    const row = screen.getByTestId("infra-item-x");
    // browser fires two click events before dblclick; the second (detail === 2)
    // must be ignored so onEdit does not double-fire
    fireEvent.click(row, { detail: 1 });
    fireEvent.click(row, { detail: 2 });
    fireEvent.doubleClick(row);

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onLocate).toHaveBeenCalledTimes(1);
  });

  it("does not crash on double-click when onLocate is undefined", () => {
    const onEdit = vi.fn();
    renderPanel({ onEdit });

    const row = screen.getByTestId("infra-item-x");
    expect(() => fireEvent.doubleClick(row)).not.toThrow();
    expect(onEdit).not.toHaveBeenCalled();
  });
});
