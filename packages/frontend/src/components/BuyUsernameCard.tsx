import { useState } from "react";
import { useManager } from "coco-cashu-react";
import { AtSign, Check, ReceiptText, Sparkles, TriangleAlert } from "lucide-react";
import { useNpcInfo } from "@/hooks/useNpcInfo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

type PendingPurchase = { username: string; amount: number; acceptHandler: () => Promise<void> };

export function BuyUsernameCard() {
  const [username, setUsername] = useState("");
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pendingPurchase, setPendingPurchase] = useState<PendingPurchase | null>(null);
  const manager = useManager();
  const { info, refetch } = useNpcInfo();

  const handlePurchase = async () => {
    if (!username.trim()) return;
    setIsPurchasing(true); setError(null); setSuccess(false);
    try {
      const result = await manager.ext.npc.setUsername(username.trim());
      if (!result.success) {
        setPendingPurchase({ username: username.trim(), amount: result.pr.amount ?? 0, acceptHandler: result.acceptHandler });
      } else {
        setSuccess(true); setUsername(""); await refetch();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to purchase username");
    } finally { setIsPurchasing(false); }
  };

  const handleConfirm = async () => {
    if (!pendingPurchase) return;
    setIsConfirming(true); setError(null);
    try {
      await pendingPurchase.acceptHandler();
      setSuccess(true); setUsername(""); setPendingPurchase(null); await refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to confirm purchase");
    } finally { setIsConfirming(false); }
  };

  return (
    <Card className="h-full bg-secondary/30">
      <CardHeader>
        <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><AtSign /></div>
        <CardTitle>{info?.name ? "Your username" : pendingPurchase ? "Confirm username" : "Claim a username"}</CardTitle>
        <CardDescription>
          {info?.name ? "Your memorable npub.cash identity." : "Replace your long npub with an address people remember."}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-4">
        {info?.name ? (
          <div className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Badge variant="secondary" className="w-fit"><Check data-icon="inline-start" />Registered</Badge>
            <span className="break-all font-mono text-lg font-semibold">{info.name}@npub.cash</span>
          </div>
        ) : pendingPurchase ? (
          <>
            <div className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <Badge variant="outline" className="w-fit"><ReceiptText data-icon="inline-start" />Purchase summary</Badge>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground">Username</span>
                <span className="font-mono font-medium">{pendingPurchase.username}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="font-semibold">{pendingPurchase.amount.toLocaleString()} sats</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="sm:flex-1" onClick={handleConfirm} disabled={isConfirming}>
                {isConfirming ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
                {isConfirming ? "Confirming…" : "Confirm purchase"}
              </Button>
              <Button variant="outline" onClick={() => { setPendingPurchase(null); setError(null); }} disabled={isConfirming}>Cancel</Button>
            </div>
          </>
        ) : (
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="username">Choose your username</FieldLabel>
              <InputGroup className="h-10">
                <InputGroupInput id="username" placeholder="satoshi" value={username} onChange={(event) => setUsername(event.target.value)} aria-invalid={!!error} />
                <InputGroupAddon align="inline-end"><InputGroupText>@npub.cash</InputGroupText></InputGroupAddon>
              </InputGroup>
              <FieldDescription>Short, recognizable, and tied to your current Nostr key.</FieldDescription>
              {error && <FieldError>{error}</FieldError>}
            </Field>
            <Button onClick={handlePurchase} disabled={isPurchasing || !username.trim()}>
              {isPurchasing ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
              {isPurchasing ? "Checking availability…" : "Check username"}
            </Button>
          </FieldGroup>
        )}
        {success && (
          <Alert><Check /><AlertTitle>Username purchased</AlertTitle><AlertDescription>Your new address is ready to share.</AlertDescription></Alert>
        )}
        {error && pendingPurchase && (
          <Alert variant="destructive"><TriangleAlert /><AlertTitle>Purchase failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        )}
      </CardContent>
    </Card>
  );
}
