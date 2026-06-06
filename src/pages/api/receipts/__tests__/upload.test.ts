import { afterEach, describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

// vi.mock is hoisted before imports — these replace the real modules for all tests.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/llm", () => ({
  openai: {
    chat: { completions: { create: vi.fn() } },
    embeddings: { create: vi.fn() },
  },
}));

import { createClient } from "@/lib/supabase";
import { openai } from "@/lib/llm";
import { POST } from "../upload";
import {
  INVALID_LINE_ITEM_EXTRACTION,
  VALID_EXTRACTION,
  makeContext,
  makeImageFormData,
  makeRequest,
  makeSupabaseMock,
} from "./helpers";

// Typed shorthand so POST(ctx()) satisfies the APIContext parameter without unsafe casts.
function ctx(): APIContext {
  return makeContext(makeRequest(makeImageFormData())) as APIContext;
}

// Consolidate the unbound-method access into one place so we only need one disable comment.
function mockLlmWith(content: string): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  vi.mocked(openai.chat.completions.create).mockResolvedValueOnce({
    choices: [{ message: { content } }],
  } as never);
}

function mockLlmFail(error = new Error("network error")): void {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  vi.mocked(openai.chat.completions.create).mockRejectedValueOnce(error);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/receipts/upload", () => {
  // ─── Happy path ────────────────────────────────────────────────────────────

  it("HP: returns 200 with receipt fields; update called with processing_status=done", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockReturnValue(mock as never);
    mockLlmWith(VALID_EXTRACTION);

    const res = await POST(ctx());

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("receiptId");
    expect(body).toHaveProperty("lineItemCount", 1);

    const doneCalls = mock._updateMock.mock.calls.filter((args) => args[0].processing_status === "done");
    expect(doneCalls).toHaveLength(1);
  });

  // ─── S1: Storage upload fails ──────────────────────────────────────────────

  it("S1: storage upload error → 500 'Storage upload failed'; no receipt INSERT attempted", async () => {
    const mock = makeSupabaseMock({ storageUploadError: true });
    vi.mocked(createClient).mockReturnValue(mock as never);

    const res = await POST(ctx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Storage upload failed");

    // INSERT must never be called — no receipt row can be created.
    expect(mock.from).not.toHaveBeenCalledWith("receipts");
  });

  // ─── S2: Receipt INSERT fails ──────────────────────────────────────────────

  it("S2: receipt INSERT error → 500 'Failed to create receipt record'; no update attempted", async () => {
    const mock = makeSupabaseMock({ receiptsInsertError: true });
    vi.mocked(createClient).mockReturnValue(mock as never);

    const res = await POST(ctx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Failed to create receipt record");

    // update must never be called — no receiptId exists yet.
    expect(mock._updateMock).not.toHaveBeenCalled();
  });

  // ─── S3: Signed URL fails ──────────────────────────────────────────────────

  it("S3: signed URL error → 500 'Failed to generate image URL'; update sets processing_status=failed", async () => {
    const mock = makeSupabaseMock({ signedUrlError: true });
    vi.mocked(createClient).mockReturnValue(mock as never);

    const res = await POST(ctx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Failed to generate image URL");

    const failedCalls = mock._updateMock.mock.calls.filter((args) => args[0].processing_status === "failed");
    expect(failedCalls).toHaveLength(1);
  });

  // ─── S4: LLM call throws ──────────────────────────────────────────────────

  it("S4: LLM throws → 500 'LLM extraction failed'; update sets processing_status=failed", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockReturnValue(mock as never);
    mockLlmFail();

    const res = await POST(ctx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("LLM extraction failed");

    const failedCalls = mock._updateMock.mock.calls.filter((args) => args[0].processing_status === "failed");
    expect(failedCalls).toHaveLength(1);
  });

  // ─── S5: LLM returns invalid JSON ─────────────────────────────────────────

  it("S5: LLM returns non-JSON → 500 'LLM extraction failed'; update sets processing_status=failed", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockReturnValue(mock as never);
    mockLlmWith("not valid json at all");

    const res = await POST(ctx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("LLM extraction failed");

    const failedCalls = mock._updateMock.mock.calls.filter((args) => args[0].processing_status === "failed");
    expect(failedCalls).toHaveLength(1);
  });

  // ─── S6: Invalid line item ────────────────────────────────────────────────

  it("S6: LLM returns item with price=-1 → 500 'LLM extraction failed'; update sets processing_status=failed", async () => {
    const mock = makeSupabaseMock();
    vi.mocked(createClient).mockReturnValue(mock as never);
    mockLlmWith(INVALID_LINE_ITEM_EXTRACTION);

    const res = await POST(ctx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("LLM extraction failed");

    const failedCalls = mock._updateMock.mock.calls.filter((args) => args[0].processing_status === "failed");
    expect(failedCalls).toHaveLength(1);
  });

  // ─── S7: line_items INSERT fails ─────────────────────────────────────────

  it("S7: line_items INSERT error → 500 'Failed to save line items'; update sets processing_status=failed", async () => {
    const mock = makeSupabaseMock({ lineItemsInsertError: true });
    vi.mocked(createClient).mockReturnValue(mock as never);
    mockLlmWith(VALID_EXTRACTION);

    const res = await POST(ctx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Failed to save line items");

    const failedCalls = mock._updateMock.mock.calls.filter((args) => args[0].processing_status === "failed");
    expect(failedCalls).toHaveLength(1);
  });

  // ─── S8: Final UPDATE fails ───────────────────────────────────────────────

  it("S8: final status UPDATE error → 500 'Failed to finalize receipt'; recovery sets processing_status=failed", async () => {
    const mock = makeSupabaseMock({ finalUpdateError: true });
    vi.mocked(createClient).mockReturnValue(mock as never);
    mockLlmWith(VALID_EXTRACTION);

    const res = await POST(ctx());

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("Failed to finalize receipt");

    // The attempted 'done' update and the Phase 2 recovery update are both recorded.
    const allStatuses = mock._updateMock.mock.calls.map((args) => args[0].processing_status);
    expect(allStatuses).toContain("done"); // attempted
    expect(allStatuses).toContain("failed"); // recovery (Phase 2 fix)
  });
});
