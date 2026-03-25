import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const replaceMock = vi.fn();
const router = {
  push: pushMock,
  replace: replaceMock,
};

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

describe("Signup page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_API_BASE = "http://localhost:4000";
  });

  it("creates an account and redirects to the dashboard", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/me")) {
        return Promise.reject(new Error("not authenticated"));
      }

      if (url.endsWith("/auth/signup")) {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({ ok: true }),
        });
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { default: Signup } = await import("../app/signup/page");
    render(<Signup />);

    const user = userEvent.setup();
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("http://localhost:4000/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: "new@example.com", password: "password123" }),
      });
      expect(pushMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows a network error when signup fails unexpectedly", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/me")) {
        return Promise.reject(new Error("not authenticated"));
      }

      if (url.endsWith("/auth/signup")) {
        return Promise.reject(new Error("network"));
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { default: Signup } = await import("../app/signup/page");
    render(<Signup />);

    const user = userEvent.setup();
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Network error. Please try again.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
