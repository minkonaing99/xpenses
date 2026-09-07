import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("unwraps a success envelope", async () => {
    mockFetch({ ok: true, data: { hi: 1 } });
    await expect(api.get("/x")).resolves.toEqual({ hi: 1 });
  });

  it("preserves the next cursor for paginated reads", async () => {
    mockFetch({ ok: true, data: [{ id: "t1" }], meta: { nextCursor: "next-page" } });

    await expect(api.getPage("/transactions?limit=200")).resolves.toEqual({
      data: [{ id: "t1" }],
      nextCursor: "next-page",
    });
  });

  it("rejects a malformed pagination cursor", async () => {
    mockFetch({ ok: true, data: [], meta: { nextCursor: 42 } });
    await expect(api.getPage("/transactions?limit=200")).rejects.toMatchObject({
      code: "SERVER_ERROR",
      message: "Invalid pagination cursor from server.",
    });
  });

  it("rejects a blank pagination cursor", async () => {
    mockFetch({ ok: true, data: [], meta: { nextCursor: "   " } });
    await expect(api.getPage("/transactions?limit=200")).rejects.toMatchObject({
      code: "SERVER_ERROR",
      message: "Invalid pagination cursor from server.",
    });
  });

  it("throws ApiError with code on an error envelope", async () => {
    mockFetch({ ok: false, error: { code: "VALIDATION_ERROR", message: "bad" } }, 400);
    await expect(api.post("/x", {})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "bad",
      status: 400,
    });
  });

  it("treats a skipped write as a conflict", async () => {
    mockFetch({ ok: true, data: { id: "t1" }, meta: { syncStatus: "skipped" } });

    await expect(api.patch("/transactions/t1", {})).rejects.toMatchObject({
      code: "CONFLICT",
      message: "A newer server change was kept.",
    });
  });

  it("maps a thrown fetch to a NETWORK ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    const err = await api.get("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("NETWORK");
  });

  it("throws on non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 500 })));
    await expect(api.get("/x")).rejects.toMatchObject({ code: "SERVER_ERROR" });
  });
});
