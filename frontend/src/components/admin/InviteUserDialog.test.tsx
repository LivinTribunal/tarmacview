import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InviteUserDialog from "./InviteUserDialog";

const inviteUser = vi.fn();
vi.mock("@/api/admin", () => ({
  inviteUser: (...args: unknown[]) => inviteUser(...args),
}));

describe("InviteUserDialog", () => {
  beforeEach(() => {
    inviteUser.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn() },
      configurable: true,
    });
  });

  it("routes the post-copy label through t() instead of a hardcoded literal", async () => {
    inviteUser.mockResolvedValue({ invitation_link: "/setup?token=abc" });

    render(
      <InviteUserDialog
        isOpen
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        airports={[]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("admin.emailPlaceholder"), {
      target: { value: "pilot@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("admin.namePlaceholder"), {
      target: { value: "Test Pilot" },
    });
    fireEvent.click(screen.getByText("admin.sendInvitation"));

    const copyButton = await screen.findByText("admin.copyLink");
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(screen.getByText("admin.copied")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
  });
});
