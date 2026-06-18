/**
 * tests for LoginPage post-login routing and the error lifecycle.
 * token storage behavior is already covered in App.test.tsx.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import client from "@/api/client";
import LoginPage from "./LoginPage";

vi.mock("@/api/client", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
  isAxiosError: vi.fn(),
}));

const MOCK_USER = {
  id: "u-1",
  email: "test@example.com",
  name: "Test User",
  role: "OPERATOR",
  airports: [],
};

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/operator-center/dashboard" element={<div>dashboard page</div>} />
          <Route
            path="/operator-center/airport-selection"
            element={<div>airport selection page</div>}
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function fillFields() {
  await waitFor(() => {
    expect(screen.getByTestId("email-input")).toBeInTheDocument();
  });
  fireEvent.change(screen.getByTestId("email-input"), {
    target: { value: "test@example.com" },
  });
  fireEvent.change(screen.getByTestId("password-input"), {
    target: { value: "password123" },
  });
}

async function fillAndSubmit() {
  await fillFields();
  fireEvent.click(screen.getByTestId("login-button"));
}

describe("LoginPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    // mount-time refresh has no cookie
    vi.mocked(client.post).mockRejectedValueOnce(new Error("no cookie"));
  });

  it("navigates to the dashboard when an airport is persisted", async () => {
    localStorage.setItem("tarmacview_airport", JSON.stringify({ id: "apt-1" }));
    vi.mocked(client.post).mockResolvedValueOnce({
      data: { access_token: "tok", user: MOCK_USER },
    });

    renderLogin();
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText("dashboard page")).toBeInTheDocument();
    });
    expect(client.post).toHaveBeenCalledWith("/auth/login", {
      email: "test@example.com",
      password: "password123",
    });
  });

  it("navigates to airport selection when no airport is persisted", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({
      data: { access_token: "tok", user: MOCK_USER },
    });

    renderLogin();
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText("airport selection page")).toBeInTheDocument();
    });
  });

  it("submits on Enter in the password field, identical to clicking Login", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({
      data: { access_token: "tok", user: MOCK_USER },
    });

    renderLogin();
    await fillFields();
    fireEvent.keyDown(screen.getByTestId("password-input"), { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("airport selection page")).toBeInTheDocument();
    });
    expect(client.post).toHaveBeenCalledWith("/auth/login", {
      email: "test@example.com",
      password: "password123",
    });
  });

  it("submits on Enter in the email field too", async () => {
    vi.mocked(client.post).mockResolvedValueOnce({
      data: { access_token: "tok", user: MOCK_USER },
    });

    renderLogin();
    await fillFields();
    fireEvent.keyDown(screen.getByTestId("email-input"), { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("airport selection page")).toBeInTheDocument();
    });
  });

  it("ignores Enter while composing (IME)", async () => {
    renderLogin();
    await fillFields();
    fireEvent.keyDown(screen.getByTestId("password-input"), {
      key: "Enter",
      isComposing: true,
    });

    // only the mount-time refresh ran; no /auth/login submit
    expect(client.post).not.toHaveBeenCalledWith(
      "/auth/login",
      expect.anything(),
    );
  });

  it("shows the error on failure and clears it before the retry resolves", async () => {
    vi.mocked(client.post).mockRejectedValueOnce(new Error("401"));

    renderLogin();
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText("auth.wrongCredentials")).toBeInTheDocument();
    });

    // hold the retry open to observe the error clearing mid-flight
    let resolveLogin!: (value: unknown) => void;
    vi.mocked(client.post).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        }),
    );
    fireEvent.click(screen.getByTestId("login-button"));

    await waitFor(() => {
      expect(screen.queryByText("auth.wrongCredentials")).not.toBeInTheDocument();
    });
    expect(screen.getByText("auth.loggingIn")).toBeInTheDocument();

    await act(async () => {
      resolveLogin({ data: { access_token: "tok", user: MOCK_USER } });
    });
    await waitFor(() => {
      expect(screen.getByText("airport selection page")).toBeInTheDocument();
    });
  });
});
