import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";

const MAX_DIMENSION = 1920;

async function resizeImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not available"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Canvas toBlob failed"));
          }
        },
        "image/jpeg",
        0.85,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

export function UploadForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Please select an image.");
      return;
    }

    setLoading(true);
    setError(null);
    setStatusText("Resizing image…");

    try {
      const blob = await resizeImage(file);
      setStatusText("Uploading…");
      const form = new FormData();
      form.append("image", blob, "receipt.jpg");
      const res = await fetch("/api/receipts/upload", { method: "POST", body: form });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Upload failed");
      }
      window.location.href = "/receipts";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setLoading(false);
      setStatusText("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <ServerError message={error} />
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">Receipt photo</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          required
          disabled={loading}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground file:mr-2 file:rounded file:border-0 file:bg-purple-600 file:px-2 file:py-1 file:text-white"
        />
      </label>
      <Button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            {statusText || "Processing…"}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <Upload className="size-4" />
            Upload receipt
          </span>
        )}
      </Button>
    </form>
  );
}
