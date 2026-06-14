import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = "idle" | "confirming" | "loading" | "error";

interface Props {
  receiptId: string;
}

export default function DeleteReceiptButton({ receiptId }: Props) {
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleConfirm = async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/receipts/${receiptId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      window.location.href = "/receipts";
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  };

  if (state === "idle") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => {
          setState("confirming");
        }}
      >
        <Trash2 className="size-4" />
        <span className="sr-only">Delete receipt</span>
      </Button>
    );
  }

  if (state === "confirming") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">Delete?</span>
        <Button variant="destructive" size="sm" onClick={handleConfirm}>
          Yes, delete
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setState("idle");
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <Button variant="destructive" size="sm" disabled>
        Deleting…
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-destructive text-sm">{errorMsg}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setState("idle");
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
