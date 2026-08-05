import { useBalanceContext } from "coco-cashu-react";
import { Landmark, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function mintName(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

export function BalanceCard() {
  const { balance } = useBalanceContext();
  const mints = Object.entries(balance).filter(([key]) => key !== "total");

  return (
    <Card className="h-full border-primary/20 bg-primary text-primary-foreground shadow-xl shadow-primary/10">
      <CardHeader>
        <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-primary-foreground/15">
          <WalletCards />
        </div>
        <CardDescription className="text-primary-foreground/70">Available balance</CardDescription>
        <CardTitle className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {balance.total.toLocaleString()}
          <span className="ml-2 text-base font-medium text-primary-foreground/65">sats</span>
        </CardTitle>
        <CardAction><Badge variant="secondary">Live balance</Badge></CardAction>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-4">
        <Separator className="bg-primary-foreground/20" />
        {mints.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {mints.map(([mintUrl, amount]) => (
              <Badge key={mintUrl} variant="secondary" className="gap-1.5">
                <Landmark data-icon="inline-start" />
                {mintName(mintUrl)} · {Number(amount).toLocaleString()} sats
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-primary-foreground/70">
            Add a mint to start holding eCash.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
