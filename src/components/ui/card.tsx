import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-border bg-card rounded-lg border", className)} {...props} />;
}

export { Card };
