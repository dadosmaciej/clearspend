import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { openai } from "@/lib/llm";

interface LineItemSnippet {
  name: string;
  category: string | null;
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

  const userId = context.locals.user.id;

  const { data: receipts } = await supabase
    .from("receipts")
    .select("id, shop_name, purchase_date, line_items(name, category)")
    .eq("user_id", userId)
    .eq("processing_status", "done")
    .is("embedding", null);

  if (!receipts?.length) {
    return new Response(JSON.stringify({ backfilled: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let backfilled = 0;

  for (const receipt of receipts) {
    try {
      const lineItems = receipt.line_items as LineItemSnippet[];
      const embeddingText = [
        receipt.shop_name ?? "Unknown shop",
        receipt.purchase_date ?? "",
        ...lineItems.map((item) => `${item.name} ${item.category ?? ""}`),
      ]
        .filter(Boolean)
        .join(" ");

      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: embeddingText,
      });
      const vector = embeddingResponse.data[0].embedding;
      await supabase.from("receipts").update({ embedding: vector }).eq("id", receipt.id);
      backfilled++;
    } catch {
      // Skip failed receipts — next backfill call will retry them.
    }
  }

  return new Response(JSON.stringify({ backfilled }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
