import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-neutral-700/60 text-neutral-300",
        pending: "bg-neutral-700/60 text-neutral-300",
        processing: "bg-yellow-900/40 text-yellow-300",
        done: "bg-green-900/40 text-green-300",
        failed: "bg-red-900/40 text-red-300",
        food: "bg-green-900/40 text-green-300",
        fuel: "bg-yellow-900/40 text-yellow-300",
        electronics: "bg-blue-900/40 text-blue-300",
        household: "bg-neutral-700/60 text-neutral-300",
        health: "bg-neutral-700/60 text-neutral-300",
        clothing: "bg-neutral-700/60 text-neutral-300",
        transport: "bg-neutral-700/60 text-neutral-300",
        entertainment: "bg-neutral-700/60 text-neutral-300",
        other: "bg-neutral-700/60 text-neutral-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
