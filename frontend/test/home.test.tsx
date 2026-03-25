import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const router = {
  replace: replaceMock,
};

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

describe("Home page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_API_BASE = "http://localhost:4000";
  });

  it("renders the marketing content when the user is not authenticated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const { default: Home } = await import("../app/page");
    render(<Home />);

    expect(await screen.findByRole("heading", { name: "AI Stock Analyzer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/signup");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects authenticated users to the dashboard", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ user: { id: "user_1" } }),
    }));

    const { default: Home } = await import("../app/page");
    render(<Home />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard");
    });
  });
});
