import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { openai } from "@/lib/llm";

const CATEGORIES = ["food", "fuel", "electronics", "household", "health", "clothing", "transport", "entertainment"];

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function parseDateWindow(question: string): { from: string; to: string } | null {
  const q = question.toLowerCase();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (q.includes("this month")) {
    const from = new Date(year, month, 1);
    const to = new Date(year, month + 1, 0);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  if (q.includes("last month")) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  if (q.includes("this year")) {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  if (q.includes("last year")) {
    return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  }

  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (q.includes(MONTH_NAMES[i])) {
      const targetYear = i > month ? year - 1 : year;
      const from = new Date(targetYear, i, 1);
      const to = new Date(targetYear, i + 1, 0);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    }
  }

  return null;
}

function buildEmbeddingText(
  shopName: string | null,
  purchaseDate: string | null,
  lineItems: { name: string; category: string | null }[],
): string {
  return [
    shopName ?? "Unknown shop",
    purchaseDate ?? "",
    ...lineItems.map((item) => `${item.name} ${item.category ?? ""}`),
  ]
    .filter(Boolean)
    .join(" ");
}

interface ReceiptForContext {
  id: string;
  shop_name: string | null;
  purchase_date: string | null;
  total_amount: number | null;
  line_items: { name: string; price: number; category: string | null }[];
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

  let question: string;
  try {
    const body = (await context.request.json()) as { question?: unknown };
    if (typeof body.question !== "string" || !body.question.trim()) {
      return new Response(JSON.stringify({ error: "question is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    question = body.question.trim();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = context.locals.user.id;

  // Lazy backfill: embed any done receipts missing embeddings before we search
  try {
    const { data: unembedded } = await supabase
      .from("receipts")
      .select("id, shop_name, purchase_date, line_items(name, category)")
      .eq("user_id", userId)
      .eq("processing_status", "done")
      .is("embedding", null);

    if (unembedded?.length) {
      for (const r of unembedded) {
        try {
          const items = r.line_items as { name: string; category: string | null }[];
          const text = buildEmbeddingText(r.shop_name, r.purchase_date, items);
          const resp = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
          const vector = resp.data[0].embedding;
          await supabase.from("receipts").update({ embedding: vector }).eq("id", r.id);
        } catch {
          // Skip failed individual backfill
        }
      }
    }
  } catch {
    // Backfill failure must not block the query
  }

  // Embed the question
  let queryEmbedding: number[];
  try {
    const embResp = await openai.embeddings.create({ model: "text-embedding-3-small", input: question });
    queryEmbedding = embResp.data[0].embedding;
  } catch {
    return new Response(JSON.stringify({ error: "Query processing failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const idSet = new Set<string>();

  // Vector similarity search
  try {
    const { data: vectorResults } = await supabase.rpc("match_receipts", {
      query_embedding: queryEmbedding,
      match_threshold: 0.3,
      match_count: 15,
      p_user_id: userId,
    });
    if (vectorResults) {
      for (const r of vectorResults) {
        idSet.add(r.id);
      }
    }
  } catch {
    // Non-fatal — proceed with other sources
  }

  // Date window supplement
  const dateWindow = parseDateWindow(question);
  if (dateWindow) {
    try {
      const { data: dateResults } = await supabase
        .from("receipts")
        .select("id")
        .eq("user_id", userId)
        .eq("processing_status", "done")
        .gte("purchase_date", dateWindow.from)
        .lte("purchase_date", dateWindow.to);
      if (dateResults) {
        for (const r of dateResults) {
          idSet.add(r.id);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // Category supplement
  const q = question.toLowerCase();
  for (const cat of CATEGORIES) {
    if (q.includes(cat)) {
      try {
        const { data: catResults } = await supabase.from("line_items").select("receipt_id").eq("category", cat);
        if (catResults) {
          for (const r of catResults) {
            idSet.add(r.receipt_id);
          }
        }
      } catch {
        // Non-fatal
      }
    }
  }

  const mergedIds = [...idSet].slice(0, 20);

  if (mergedIds.length === 0) {
    return new Response(
      JSON.stringify({
        answer: "I couldn't find any receipts relevant to your question. Try rephrasing or check your date filter.",
        sources: [],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // Fetch full receipt data for context
  const { data: receipts } = await supabase
    .from("receipts")
    .select("id, shop_name, purchase_date, total_amount, line_items(name, price, category)")
    .in("id", mergedIds)
    .eq("user_id", userId);

  const receiptList = (receipts ?? []) as ReceiptForContext[];

  const receiptsText = receiptList
    .map((r) => {
      const items = r.line_items
        .map((item) => `${item.name} (${item.category ?? "other"}) €${item.price.toFixed(2)}`)
        .join(", ");
      return `[Receipt ID: ${r.id}]\nShop: ${r.shop_name ?? "Unknown"} | Date: ${r.purchase_date ?? "Unknown"} | Total: €${(r.total_amount ?? 0).toFixed(2)}\nItems: ${items}`;
    })
    .join("\n\n");

  let answer = "I couldn't process the answer. Please try again.";
  let citedIds: string[] = [];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expense analysis assistant. Answer the user's question using ONLY the receipts provided. Return a JSON object: { "answer": "...", "cited_receipt_ids": ["id1", "id2"] }. cited_receipt_ids must be IDs from the provided receipts only. If the data is insufficient, explain what's missing in the answer field. Never invent amounts.`,
        },
        {
          role: "user",
          content: `Receipts:\n${receiptsText}\n\nQuestion: ${question}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1000,
    });

    const content = completion.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(content) as { answer?: string; cited_receipt_ids?: string[] };

    if (typeof parsed.answer === "string") answer = parsed.answer;
    if (Array.isArray(parsed.cited_receipt_ids)) {
      citedIds = parsed.cited_receipt_ids.filter(
        (id): id is string => typeof id === "string" && mergedIds.includes(id),
      );
    }
  } catch {
    // Return fallback answer below
  }

  const sources = citedIds
    .map((id) => {
      const r = receiptList.find((rec) => rec.id === id);
      if (!r) return null;
      return { id: r.id, shop_name: r.shop_name, purchase_date: r.purchase_date, total_amount: r.total_amount };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return new Response(JSON.stringify({ answer, sources }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
