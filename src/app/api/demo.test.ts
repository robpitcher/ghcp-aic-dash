import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getUsage } from "@/app/api/usage/me/route";
import { GET as getBudget } from "@/app/api/budget/me/route";

describe("demo API mode", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env = { DEMO_ENV: "true" };
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...original };
  });

  it("serves usage without identity or billing credentials", async () => {
    const response = await getUsage(
      new NextRequest("https://dash.test/api/usage/me?year=2026&month=8"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scopedLogin).toBe("demo-user");
    expect(body.totals.grossCredits).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the lowercase demo_env alias", async () => {
    process.env = { DEMO_ENV: "false", demo_env: "true" };
    const response = await getUsage(
      new NextRequest("https://dash.test/api/usage/me?year=2026&month=8"),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).scopedLogin).toBe("demo-user");
  });

  it("serves synthetic budget without contacting GitHub", async () => {
    const response = await getBudget(
      new NextRequest("https://dash.test/api/budget/me"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      scopedLogin: "demo-user",
      amountCredits: 5000,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
