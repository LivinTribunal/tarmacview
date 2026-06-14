/**
 * tests for the ProtectedRoute role hierarchy (OPERATOR < COORDINATOR < SUPER_ADMIN).
 * the unauthenticated -> /login redirect is already covered in App.test.tsx.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import ProtectedRoute from "./ProtectedRoute";

// mutable auth state read by the mocked useAuth - tests tweak it per case
const authState = vi.hoisted(() => ({
  isAuthenticated: true,
  isLoading: false,
  user: null as { id: string; email: string; name: string; role: string } | null,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => authState,
}));

function setRole(role: string) {
  authState.user = {
    id: "u-1",
    email: "user@example.com",
    name: "Test User",
    role,
  };
}

// guarded probes mirror App.tsx's three role sections; the redirect targets
// (/operator-center/dashboard, /coordinator-center/airports) are unguarded
// probes so the landing page is observable
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/operator-center/dashboard" element={<div>operator home</div>} />
        <Route path="/coordinator-center/airports" element={<div>coordinator home</div>} />
        <Route element={<ProtectedRoute requiredRole="OPERATOR" />}>
          <Route path="/operator-center/missions" element={<div>operator content</div>} />
        </Route>
        <Route element={<ProtectedRoute requiredRole="COORDINATOR" />}>
          <Route path="/coordinator-center/drones" element={<div>coordinator content</div>} />
        </Route>
        <Route element={<ProtectedRoute requiredRole="SUPER_ADMIN" />}>
          <Route path="/super-admin/users" element={<div>super admin content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute role hierarchy", () => {
  beforeEach(() => {
    authState.isAuthenticated = true;
    authState.isLoading = false;
    setRole("OPERATOR");
  });

  it("renders neither outlet nor redirect while auth is loading", () => {
    authState.isLoading = true;
    renderAt("/operator-center/missions");
    expect(screen.queryByText("operator content")).not.toBeInTheDocument();
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
  });

  it("allows OPERATOR on an operator route", () => {
    renderAt("/operator-center/missions");
    expect(screen.getByText("operator content")).toBeInTheDocument();
  });

  it("redirects OPERATOR from a coordinator route to the operator default", () => {
    renderAt("/coordinator-center/drones");
    expect(screen.getByText("operator home")).toBeInTheDocument();
    expect(screen.queryByText("coordinator content")).not.toBeInTheDocument();
  });

  it("redirects OPERATOR from a super-admin route to the operator default", () => {
    renderAt("/super-admin/users");
    expect(screen.getByText("operator home")).toBeInTheDocument();
    expect(screen.queryByText("super admin content")).not.toBeInTheDocument();
  });

  it("allows COORDINATOR on coordinator and operator routes", () => {
    setRole("COORDINATOR");
    const { unmount } = renderAt("/coordinator-center/drones");
    expect(screen.getByText("coordinator content")).toBeInTheDocument();
    unmount();

    renderAt("/operator-center/missions");
    expect(screen.getByText("operator content")).toBeInTheDocument();
  });

  it("redirects COORDINATOR from a super-admin route to the coordinator default", () => {
    setRole("COORDINATOR");
    renderAt("/super-admin/users");
    expect(screen.getByText("coordinator home")).toBeInTheDocument();
    expect(screen.queryByText("super admin content")).not.toBeInTheDocument();
  });

  it("allows SUPER_ADMIN on every role section", () => {
    setRole("SUPER_ADMIN");
    const { unmount: unmountAdmin } = renderAt("/super-admin/users");
    expect(screen.getByText("super admin content")).toBeInTheDocument();
    unmountAdmin();

    const { unmount: unmountCoordinator } = renderAt("/coordinator-center/drones");
    expect(screen.getByText("coordinator content")).toBeInTheDocument();
    unmountCoordinator();

    renderAt("/operator-center/missions");
    expect(screen.getByText("operator content")).toBeInTheDocument();
  });

  it("falls back to the operator default for an unknown role", () => {
    setRole("INTERN");
    renderAt("/operator-center/missions");
    expect(screen.getByText("operator home")).toBeInTheDocument();
    expect(screen.queryByText("operator content")).not.toBeInTheDocument();
  });

  it("falls back to the operator default when user is null", () => {
    authState.user = null;
    renderAt("/coordinator-center/drones");
    expect(screen.getByText("operator home")).toBeInTheDocument();
    expect(screen.queryByText("coordinator content")).not.toBeInTheDocument();
  });
});
