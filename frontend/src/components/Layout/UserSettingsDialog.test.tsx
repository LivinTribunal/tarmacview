import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import UserSettingsDialog from "./UserSettingsDialog";

const updateMe = vi.fn();
const refreshUser = vi.fn();

vi.mock("@/api/auth", () => ({
  updateMe: (...args: unknown[]) => updateMe(...args),
}));

vi.mock("@/api/client", () => ({
  isAxiosError: (e: unknown) =>
    typeof e === "object" && e !== null && "isAxiosError" in e,
}));

const mockUser = {
  id: "u1",
  email: "pilot@example.com",
  name: "Test Pilot",
  role: "OPERATOR" as const,
  airports: [
    { id: "a1", icao_code: "LZIB", name: "Bratislava" },
    { id: "a2", icao_code: "LZKZ", name: "Košice" },
  ],
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, refreshUser }),
}));

describe("UserSettingsDialog", () => {
  beforeEach(() => {
    updateMe.mockReset();
    refreshUser.mockReset();
  });

  it("shows email, role, and airports read-only", () => {
    render(<UserSettingsDialog isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId("user-settings-email")).toHaveTextContent(
      "pilot@example.com",
    );
    expect(screen.getByTestId("user-settings-role")).toHaveTextContent(
      "admin.role.operator",
    );
    const airports = screen.getByTestId("user-settings-airports");
    expect(airports).toHaveTextContent("LZIB");
    expect(airports).toHaveTextContent("LZKZ");
  });

  it("updates the name and refreshes the auth user", async () => {
    updateMe.mockResolvedValue(mockUser);
    render(<UserSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.change(screen.getByTestId("user-settings-name"), {
      target: { value: "New Name" },
    });
    fireEvent.click(screen.getByTestId("user-settings-save-name"));

    await waitFor(() =>
      expect(updateMe).toHaveBeenCalledWith({ name: "New Name" }),
    );
    expect(refreshUser).toHaveBeenCalled();
    expect(
      await screen.findByTestId("user-settings-name-success"),
    ).toBeInTheDocument();
  });

  it("changes the password on the happy path", async () => {
    updateMe.mockResolvedValue(mockUser);
    render(<UserSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("user-settings-tab-security"));
    fireEvent.change(screen.getByTestId("user-settings-current-password"), {
      target: { value: "oldpassword" },
    });
    fireEvent.change(screen.getByTestId("user-settings-new-password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByTestId("user-settings-confirm-password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.click(screen.getByTestId("user-settings-save-password"));

    await waitFor(() =>
      expect(updateMe).toHaveBeenCalledWith({
        current_password: "oldpassword",
        password: "newpassword1",
      }),
    );
    expect(
      await screen.findByTestId("user-settings-password-success"),
    ).toBeInTheDocument();
  });

  it("rejects a new password under 8 characters without calling the API", () => {
    render(<UserSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("user-settings-tab-security"));
    fireEvent.change(screen.getByTestId("user-settings-current-password"), {
      target: { value: "oldpassword" },
    });
    fireEvent.change(screen.getByTestId("user-settings-new-password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByTestId("user-settings-confirm-password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByTestId("user-settings-save-password"));

    expect(screen.getByTestId("user-settings-password-error")).toHaveTextContent(
      "auth.passwordTooShort",
    );
    expect(updateMe).not.toHaveBeenCalled();
  });

  it("rejects a confirm mismatch without calling the API", () => {
    render(<UserSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("user-settings-tab-security"));
    fireEvent.change(screen.getByTestId("user-settings-current-password"), {
      target: { value: "oldpassword" },
    });
    fireEvent.change(screen.getByTestId("user-settings-new-password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByTestId("user-settings-confirm-password"), {
      target: { value: "newpassword2" },
    });
    fireEvent.click(screen.getByTestId("user-settings-save-password"));

    expect(screen.getByTestId("user-settings-password-error")).toHaveTextContent(
      "auth.passwordMismatch",
    );
    expect(updateMe).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when the current password is wrong", async () => {
    updateMe.mockRejectedValue({ isAxiosError: true, response: { status: 400 } });
    render(<UserSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("user-settings-tab-security"));
    fireEvent.change(screen.getByTestId("user-settings-current-password"), {
      target: { value: "wrongpassword" },
    });
    fireEvent.change(screen.getByTestId("user-settings-new-password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.change(screen.getByTestId("user-settings-confirm-password"), {
      target: { value: "newpassword1" },
    });
    fireEvent.click(screen.getByTestId("user-settings-save-password"));

    expect(
      await screen.findByTestId("user-settings-password-error"),
    ).toHaveTextContent("userSettings.wrongCurrentPassword");
  });

  it("resets form state when the modal is closed", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <UserSettingsDialog isOpen onClose={onClose} />,
    );

    const nameInput = screen.getByTestId(
      "user-settings-name",
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Edited Name" } });
    expect(nameInput.value).toBe("Edited Name");

    fireEvent.click(screen.getByText("common.cancel"));
    expect(onClose).toHaveBeenCalled();

    rerender(<UserSettingsDialog isOpen onClose={onClose} />);
    expect(
      (screen.getByTestId("user-settings-name") as HTMLInputElement).value,
    ).toBe("Test Pilot");
  });
});
