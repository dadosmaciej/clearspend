import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { openai } from "@/lib/llm";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];
const ALLOWED_CATEGORIES = [
  "food",
  "fuel",
  "electronics",
  "household",
  "health",
  "clothing",
  "transport",
  "entertainment",
  "other",
];

const EXTRACTION_PROMPT = `You are a receipt parsing assistant. Extract information from this receipt image and return a single JSON object with no markdown formatting or code fences.

Return exactly this structure:
{
  "shop_name": "string or null",
  "purchase_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "line_items": [
    {
      "name": "item name",
      "price": number,
      "category": "food|fuel|electronics|household|health|clothing|transport|entertainment|other"
    }
  ]
}

Rules: line_items is always an array (empty array if no items are visible); all prices are positive numbers; total_amount has no currency symbol; use "other" for any item that doesn't clearly match a category.`;

interface ExtractionResult {
  shop_name: string | null;
  purchase_date: string | null;
  total_amount: number | null;
  line_items: { name: string; price: number; category: string }[];
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return new Response(JSON.stringify({ error: "Database not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let file: File;
  try {
    const form = await context.request.formData();
    const raw = form.get("image");
    if (!(raw instanceof File)) {
      return new Response(JSON.stringify({ error: "image field is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    file = raw;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid multipart body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return new Response(JSON.stringify({ error: "Unsupported image type" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (file.size > 10 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: "File too large (max 10 MB)" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = context.locals.user.id;
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

  const buf = await file.arrayBuffer();
  const { error: storageError } = await supabase.storage
    .from("receipts")
    .upload(storagePath, new Uint8Array(buf), { contentType: file.type });

  if (storageError) {
    return new Response(JSON.stringify({ error: "Storage upload failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: receipt, error: insertError } = await supabase
    .from("receipts")
    .insert({
      user_id: userId,
      image_path: storagePath,
      processing_status: "processing",
    })
    .select("id")
    .single();

  if (insertError) {
    void supabase.storage.from("receipts").remove([storagePath]);
    return new Response(JSON.stringify({ error: "Failed to create receipt record" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const receiptId = receipt.id;

  const { data: signedData, error: signedError } = await supabase.storage
    .from("receipts")
    .createSignedUrl(storagePath, 60);

  if (signedError) {
    await supabase.from("receipts").update({ processing_status: "failed" }).eq("id", receiptId);
    return new Response(JSON.stringify({ error: "Failed to generate image URL" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let extracted: ExtractionResult;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            { type: "image_url", image_url: { url: signedData.signedUrl } },
          ],
        },
      ],
      max_tokens: 1500,
    });
    const content = response.choices[0].message.content ?? "";
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).line_items)) {
      throw new Error("Unexpected LLM response shape");
    }
    extracted = parsed as ExtractionResult;
  } catch {
    await supabase.from("receipts").update({ processing_status: "failed" }).eq("id", receiptId);
    return new Response(JSON.stringify({ error: "LLM extraction failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (extracted.line_items.length > 0) {
    const invalidItem = extracted.line_items.find(
      (item) => !Number.isFinite(item.price) || item.price < 0 || !ALLOWED_CATEGORIES.includes(item.category),
    );
    if (invalidItem) {
      await supabase.from("receipts").update({ processing_status: "failed" }).eq("id", receiptId);
      return new Response(JSON.stringify({ error: "LLM extraction failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const { error: lineItemsError } = await supabase.from("line_items").insert(
      extracted.line_items.map((item, i) => ({
        receipt_id: receiptId,
        name: item.name,
        price: item.price,
        category: item.category,
        position: i,
      })),
    );
    if (lineItemsError) {
      await supabase.from("receipts").update({ processing_status: "failed" }).eq("id", receiptId);
      return new Response(JSON.stringify({ error: "Failed to save line items" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const { error: finalUpdateError } = await supabase
    .from("receipts")
    .update({
      processing_status: "done",
      shop_name: extracted.shop_name,
      purchase_date: extracted.purchase_date,
      total_amount: extracted.total_amount,
    })
    .eq("id", receiptId);

  if (finalUpdateError) {
    return new Response(JSON.stringify({ error: "Failed to finalize receipt" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Generate embedding for NL querying — failure does not abort the upload.
  try {
    const embeddingText = [
      extracted.shop_name ?? "Unknown shop",
      extracted.purchase_date ?? "",
      ...extracted.line_items.map((item) => `${item.name} ${item.category}`),
    ]
      .filter(Boolean)
      .join(" ");
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: embeddingText,
    });
    const vector = embeddingResponse.data[0].embedding;
    await supabase.from("receipts").update({ embedding: vector }).eq("id", receiptId);
  } catch {
    // Silently continue — receipt data is already saved; backfill can recover this.
  }

  return new Response(
    JSON.stringify({
      receiptId,
      shopName: extracted.shop_name,
      purchaseDate: extracted.purchase_date,
      totalAmount: extracted.total_amount,
      lineItemCount: extracted.line_items.length,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
};
