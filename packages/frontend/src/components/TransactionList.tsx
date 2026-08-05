import type { HistoryEntry } from "coco-cashu-core";
import { ArrowDownLeft, ArrowUpRight, Landmark, MoveDown, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

const transactionMeta = {
  mint: { label: "Lightning received", icon: ArrowDownLeft, incoming: true },
  receive: { label: "eCash received", icon: MoveDown, incoming: true },
  melt: { label: "Lightning paid", icon: Zap, incoming: false },
  send: { label: "eCash sent", icon: ArrowUpRight, incoming: false },
} as const;

function mintName(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

export function TransactionList({ history, isFetching }: { history: HistoryEntry[]; isFetching: boolean }) {
  if (isFetching && history.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((item) => <Skeleton key={item} className="h-14 w-full rounded-xl" />)}
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Landmark /></EmptyMedia>
          <EmptyTitle>No activity yet</EmptyTitle>
          <EmptyDescription>Your first incoming or outgoing payment will appear here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {history.map((entry) => {
        const meta = transactionMeta[entry.type];
        const date = new Date(entry.createdAt);
        return (
          <li key={entry.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-muted/60">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground"><meta.icon /></span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{meta.label}</span>
                <span className="truncate text-xs text-muted-foreground">{mintName(entry.mintUrl)} · {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </div>
            </div>
            <Badge variant={meta.incoming ? "secondary" : "outline"} className="shrink-0 font-mono">
              {meta.incoming ? "+" : "−"}{entry.amount.toLocaleString()} sats
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
