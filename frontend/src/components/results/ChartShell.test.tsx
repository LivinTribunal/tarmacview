import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ComposedChart } from "recharts";
import ChartShell from "./ChartShell";

vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 400, height: 260 }),
  };
});

describe("ChartShell", () => {
  it("renders the title and badge", () => {
    render(
      <ChartShell
        title="My chart"
        explanation="how it works"
        hasData
        badge={<span>BADGE</span>}
        testId="shell"
      >
        <ComposedChart />
      </ChartShell>,
    );
    expect(screen.getByText("My chart")).toBeInTheDocument();
    expect(screen.getByText("BADGE")).toBeInTheDocument();
  });

  it("toggles the explanation note", () => {
    render(
      <ChartShell title="t" explanation="how it works" hasData testId="shell">
        <ComposedChart />
      </ChartShell>,
    );
    expect(screen.queryByText("how it works")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("shell-explain-toggle"));
    expect(screen.getByText("how it works")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("shell-explain-toggle"));
    expect(screen.queryByText("how it works")).not.toBeInTheDocument();
  });

  it("shows the empty state when there is no data", () => {
    render(
      <ChartShell title="t" explanation="e" hasData={false} testId="shell">
        <ComposedChart />
      </ChartShell>,
    );
    expect(screen.getByText("results.noData")).toBeInTheDocument();
  });
});
