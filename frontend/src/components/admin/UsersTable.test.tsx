import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import UsersTable from "./UsersTable";
import type { UserAdminResponse } from "@/types/admin";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

const USER: UserAdminResponse = {
  id: "u-1",
  email: "alpha@example.com",
  name: "Alpha",
  role: "OPERATOR",
  is_active: true,
  airports: [],
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function baseProps() {
  return {
    loading: false,
    isEmpty: false,
    rows: [USER],
    sortKey: "created_at" as const,
    sortDir: "desc" as const,
    onSort: vi.fn(),
    onSelectUser: vi.fn(),
    onConfirmAction: vi.fn(),
  };
}

describe("UsersTable", () => {
  it("shows the loading state and no table", () => {
    render(<UsersTable {...baseProps()} loading rows={[]} />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
    expect(screen.queryByTestId("users-table")).not.toBeInTheDocument();
  });

  it("shows the empty state and no table", () => {
    render(<UsersTable {...baseProps()} isEmpty rows={[]} />);
    expect(screen.getByText("admin.noUsers")).toBeInTheDocument();
    expect(screen.queryByTestId("users-table")).not.toBeInTheDocument();
  });

  it("renders the table and wires sort + row select callbacks", () => {
    const props = baseProps();
    render(<UsersTable {...props} />);
    expect(screen.getByTestId("users-table")).toBeInTheDocument();

    fireEvent.click(screen.getByText("admin.columns.email"));
    expect(props.onSort).toHaveBeenCalledWith("email");

    fireEvent.click(screen.getByText("Alpha"));
    expect(props.onSelectUser).toHaveBeenCalledWith("u-1");
  });

  it("fires a confirm action from the row action buttons", () => {
    const props = baseProps();
    render(<UsersTable {...props} />);
    fireEvent.click(screen.getByTitle("admin.deactivateUser"));
    expect(props.onConfirmAction).toHaveBeenCalledWith({
      type: "deactivate",
      user: USER,
    });
  });
});
