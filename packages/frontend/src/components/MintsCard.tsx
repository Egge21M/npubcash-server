import { useState } from "react";
import { useMints } from "coco-cashu-react";
import { CircleCheck, Landmark, Plus, Server, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

function mintName(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

export function MintsCard() {
  const [mintUrl, setMintUrl] = useState("");
  const { mints, addNewMint } = useMints();
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddMint = async () => {
    if (!mintUrl.trim()) return;
    setIsAdding(true);
    setError(null);
    try {
      await addNewMint(mintUrl.trim(), { trusted: true });
      setMintUrl("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to add mint");
    } finally { setIsAdding(false); }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"><Landmark /></div>
        <CardTitle>Connected mints</CardTitle>
        <CardDescription>Choose where your eCash is issued.</CardDescription>
        <CardAction><Badge variant="outline">{mints.length} connected</Badge></CardAction>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-4">
        {mints.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Server /></EmptyMedia>
              <EmptyTitle>No mints yet</EmptyTitle>
              <EmptyDescription>Add a trusted Cashu mint to send and hold eCash.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {mints.map((mint) => (
              <li key={mint.mintUrl} className="flex items-center justify-between gap-3 rounded-xl bg-muted/70 p-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card"><Server /></span>
                  <span className="truncate text-sm font-medium">{mintName(mint.mintUrl)}</span>
                </span>
                <CircleCheck className="shrink-0 text-primary" />
              </li>
            ))}
          </ul>
        )}
        <FieldGroup>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="mint-url">Add a mint</FieldLabel>
            <InputGroup>
              <InputGroupInput id="mint-url" type="url" placeholder="https://mint.example.com" value={mintUrl} onChange={(event) => setMintUrl(event.target.value)} aria-invalid={!!error} />
              <InputGroupAddon align="inline-end">
                <InputGroupButton onClick={handleAddMint} disabled={isAdding || !mintUrl.trim()}>
                  {isAdding ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}Add
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {error && <FieldError>{error}</FieldError>}
          </Field>
        </FieldGroup>
        {mints.length > 0 && (
          <Alert><TriangleAlert /><AlertDescription>Only add mints you trust. Mint operators custody the backing Lightning funds.</AlertDescription></Alert>
        )}
      </CardContent>
    </Card>
  );
}
