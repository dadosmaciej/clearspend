import { useState } from "react";
import { ServerError } from "@/components/auth/ServerError";

interface Source {
  id: string;
  shop_name: string | null;
  purchase_date: string | null;
  total_amount: number | null;
}

interface QueryResult {
  answer: string;
  sources: Source[];
}

export function QueryForm() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/receipts/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as QueryResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Query failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-border bg-card rounded-lg border">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="text-foreground hover:bg-card/80 flex w-full items-center justify-between rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors"
      >
        <span>Ask about your expenses</span>
        <span className="text-muted-foreground">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="border-border border-t px-4 pt-3 pb-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <textarea
              rows={2}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
              }}
              disabled={loading}
              placeholder="e.g. How much did I spend on food last month?"
              className="border-border bg-background text-foreground placeholder:text-muted-foreground w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="self-start rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Thinking…
                </span>
              ) : (
                "Ask"
              )}
            </button>
          </form>

          {error && (
            <div className="mt-3">
              <ServerError message={error} />
            </div>
          )}

          {result && (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-foreground text-sm leading-relaxed">{result.answer}</p>

              {result.sources.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Sources</span>
                  {result.sources.map((s) => (
                    <a
                      key={s.id}
                      href={`/receipts/${s.id}`}
                      className="border-border bg-background hover:bg-card flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors"
                    >
                      <div className="flex flex-col gap-0.5">
                        <span className="text-foreground font-medium">{s.shop_name ?? "Unknown shop"}</span>
                        {s.purchase_date && <span className="text-muted-foreground text-xs">{s.purchase_date}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {s.total_amount != null && (
                          <span className="text-foreground">€{s.total_amount.toFixed(2)}</span>
                        )}
                        <span className="text-muted-foreground" aria-hidden="true">
                          →
                        </span>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
