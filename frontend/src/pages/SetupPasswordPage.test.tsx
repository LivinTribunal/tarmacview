/**
 * tests for SetupPasswordPage token guard, validation, and submit flow.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import client from "@/api/client";
import SetupPasswordPage from "./SetupPasswordPage";

vi.mock("@/api/client", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
  isAxiosError: vi.fn(),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/setup-password" element={<SetupPasswordPage />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillAndSubmit(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("auth.newPassword"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("auth.confirmPassword"), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole("button", { name: "auth.setPassword" }));
}

describe("SetupPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when the token is missing", () => {
    renderAt("/setup-password");
    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("auth.setupPasswordTitle")).not.toBeInTheDocument();
  });

  it("rejects passwords shorter than 8 characters without calling the api", () => {
    renderAt("/setup-password?token=tok-123");
    fillAndSubmit("short", "short");
    expect(screen.getByText("auth.passwordTooShort")).toBeInTheDocument();
    expect(client.post).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords without calling the api", () => {
    renderAt("/setup-password?token=tok-123");
    fillAndSubmit("password123", "password124");
    expect(screen.getByText("auth.passwordMismatch")).toBeInTheDocument();
    expect(client.post).not.toHaveBeenCalled();
  });

  it("shows an error when the api rejects the token", async () => {
    vi.mocked(client.post).mockRejectedValueOnce(new Error("410 expired"));

    renderAt("/setup-password?token=tok-123");
    fillAndSubmit("password123", "password123");

    await waitFor(() => {
      expect(screen.getByText("auth.setupPasswordError")).toBeInTheDocument();
    });
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
  });

  it("posts the token and password then navigates to login", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({ data: {} });

    renderAt("/setup-password?token=tok-123");
    fillAndSubmit("password123", "password123");

    await waitFor(() => {
      expect(screen.getByText("login page")).toBeInTheDocument();
    });
    expect(client.post).toHaveBeenCalledWith("/auth/setup-password", {
      token: "tok-123",
      password: "password123",
    });
  });
});
