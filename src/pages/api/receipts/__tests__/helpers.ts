import { vi } from "vitest";

export const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";

// 4-byte JPEG (SOI + EOI markers) — passes MIME and size checks; content irrelevant (LLM is mocked).
const MINIMAL_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

export function makeImageFormData(): FormData {
  const file = new File([MINIMAL_JPEG], "receipt.jpg", { type: "image/jpeg" });
  const fd = new FormData();
  fd.append("image", file);
  return fd;
}

export function makeRequest(formData: FormData): Request {
  return new Request("http://localhost/api/receipts/upload", {
    method: "POST",
    body: formData,
  });
}

// Returns a minimal object satisfying the properties upload.ts actually reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeContext(request: Request, userId = TEST_USER_ID): any {
  return { request, locals: { user: { id: userId } }, cookies: {} };
}

// Valid LLM extraction response — passes all route validation.
export const VALID_EXTRACTION = JSON.stringify({
  shop_name: "Test Shop",
  purchase_date: "2026-01-01",
  total_amount: 9.99,
  line_items: [{ name: "Coffee", price: 9.99, category: "food" }],
});

// Invalid extraction — line item with negative price triggers the validation guard.
export const INVALID_LINE_ITEM_EXTRACTION = JSON.stringify({
  shop_name: "Bad Shop",
  purchase_date: "2026-01-01",
  total_amount: 0,
  line_items: [{ name: "Bad Item", price: -1, category: "food" }],
});

interface MockConfig {
  storageUploadError?: boolean;
  receiptsInsertError?: boolean;
  signedUrlError?: boolean;
  lineItemsInsertError?: boolean;
  finalUpdateError?: boolean;
}

/**
 * Builds a fully-mocked Supabase client shaped to the operations upload.ts performs.
 *
 * For S3–S8 (receipt INSERT must succeed before the injected failure), the mock returns
 * a realistic fake receiptId and allows all preceding steps to succeed so the route
 * reaches the target failure point. The shared `_updateMock` spy lets tests assert
 * that `processing_status = 'failed'` was set without requiring a real DB connection.
 */
export function makeSupabaseMock(config: MockConfig = {}) {
  const receiptId = crypto.randomUUID();

  // Shared spy across all from("receipts").update(...) calls so tests can inspect all calls.
  const updateMock = vi.fn((data: Record<string, unknown>) => {
    // The final 'done' update is the only one that includes shop_name.
    const isFinalDoneUpdate = "shop_name" in data;
    const err = config.finalUpdateError && isFinalDoneUpdate ? new Error("final update failed") : null;
    return { eq: vi.fn().mockResolvedValue({ data: null, error: err }) };
  });

  const storageApiMock = {
    upload: vi
      .fn()
      .mockResolvedValue(
        config.storageUploadError
          ? { data: null, error: new Error("storage upload failed") }
          : { data: { path: `${TEST_USER_ID}/${receiptId}.jpg` }, error: null },
      ),
    createSignedUrl: vi.fn().mockResolvedValue(
      config.signedUrlError
        ? { data: null, error: new Error("signed url failed") }
        : {
            data: { signedUrl: "https://example.com/test-receipt.jpg" },
            error: null,
          },
    ),
    remove: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  // Shared insert chain — select().single() returns the insert result.
  const insertChain = {
    select: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValue(
        config.receiptsInsertError
          ? { data: null, error: new Error("receipt insert failed") }
          : { data: { id: receiptId }, error: null },
      ),
  };

  const fromMock = vi.fn((table: string) => {
    if (table === "receipts") {
      return {
        insert: vi.fn().mockReturnValue(insertChain),
        update: updateMock,
      };
    }
    if (table === "line_items") {
      return {
        insert: vi
          .fn()
          .mockResolvedValue(
            config.lineItemsInsertError
              ? { data: null, error: new Error("line items insert failed") }
              : { data: null, error: null },
          ),
      };
    }
    return {};
  });

  return {
    storage: { from: vi.fn().mockReturnValue(storageApiMock) },
    from: fromMock,
    /** The shared update spy — inspect `.mock.calls` to assert status transitions. */
    _updateMock: updateMock,
    /** The fake receipt ID the mock INSERT returns. */
    _receiptId: receiptId,
  };
}
