import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("Login page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_API_BASE = "http://localhost:4000";
  });

  it("redirects authenticated users to the dashboard", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ user: { id: "user_1" } }),
    }));

    const { default: Login } = await import("../app/login/page");
    render(<Login />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows an API configuration error when the env var is missing", async () => {
    delete process.env.NEXT_PUBLIC_API_BASE;

    const { default: Login } = await import("../app/login/page");
    render(<Login />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(screen.getByText("App configuration error. Please try again later.")).toBeInTheDocument();
  });

  it("submits credentials and navigates on success", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/me")) {
        return Promise.reject(new Error("not authenticated"));
      }

      if (url.endsWith("/auth/login")) {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({ ok: true }),
        });
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { default: Login } = await import("../app/login/page");
    render(<Login />);

    const user = userEvent.setup();
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("http://localhost:4000/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: "user@example.com", password: "password123" }),
      });
      expect(pushMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows the backend error when login fails", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/me")) {
        return Promise.reject(new Error("not authenticated"));
      }

      if (url.endsWith("/auth/login")) {
        return Promise.resolve({
          ok: false,
          json: vi.fn().mockResolvedValue({ error: "Invalid credentials" }),
        });
      }

      return Promise.reject(new Error(`Unhandled fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { default: Login } = await import("../app/login/page");
    render(<Login />);

    const user = userEvent.setup();
    await screen.findByLabelText("Email");
    await user.type(screen.getByLabelText("Email"), "user@example.com");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong-password" } });
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Invalid credentials")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
