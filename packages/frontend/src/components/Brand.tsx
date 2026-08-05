import { Link } from "@tanstack/react-router";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      aria-label="npub.cash home"
      className={cn("group inline-flex items-center gap-2.5", className)}
    >
      <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform group-hover:-rotate-3">
        <Zap aria-hidden="true" />
      </span>
      <span className="text-base font-semibold tracking-tight">
        npub<span className="text-primary">.cash</span>
      </span>
    </Link>
  );
}
