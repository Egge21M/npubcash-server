import { useState } from "react";
import { getEncodedToken } from "coco-cashu-core";
import { useMints, useSend } from "coco-cashu-react";
import { Check, Copy, RotateCcw, Send, Sparkles, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

export function SendCard() {
  const [amount, setAmount] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { mints } = useMints();
  const { prepareSend, executePreparedSend, isSending, error, reset } = useSend();

  const handleSend = async () => {
    const amountNum = Number.parseInt(amount, 10);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || !mints[0]) return;
    const prepared = await prepareSend(mints[0].mintUrl, amountNum);
    await executePreparedSend(prepared.id, {
      onSuccess: ({ token }) => {
        setGeneratedToken(getEncodedToken(token));
        setAmount("");
      },
    });
  };

  const handleCopy = async () => {
    if (!generatedToken) return;
    await navigator.clipboard.writeText(generatedToken);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setGeneratedToken(null);
    setCopied(false);
    reset();
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
          <Send />
        </div>
        <CardTitle>{generatedToken ? "Token ready" : "Send eCash"}</CardTitle>
        <CardDescription>
          {generatedToken ? "Share this Cashu token with its recipient." : "Create a private token from your wallet balance."}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-4">
        {generatedToken ? (
          <>
            <div className="flex flex-col gap-2 rounded-xl bg-muted p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary"><Sparkles data-icon="inline-start" />Cashu token</Badge>
                {copied && <Badge variant="outline"><Check data-icon="inline-start" />Copied</Badge>}
              </div>
              <code className="line-clamp-4 break-all text-xs leading-5 text-muted-foreground">{generatedToken}</code>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="sm:flex-1" onClick={handleCopy}>
                <Copy data-icon="inline-start" />Copy token
              </Button>
              <Button variant="outline" onClick={handleReset}>
                <RotateCcw data-icon="inline-start" />Start over
              </Button>
            </div>
          </>
        ) : (
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="send-amount">Amount</FieldLabel>
              <InputGroup className="h-11">
                <InputGroupInput
                  id="send-amount"
                  type="number"
                  min="1"
                  inputMode="numeric"
                  placeholder="0"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  aria-invalid={!!error}
                  className="text-lg font-medium"
                />
                <InputGroupAddon align="inline-end"><InputGroupText>sats</InputGroupText></InputGroupAddon>
              </InputGroup>
              <FieldDescription>The token is issued by your first connected mint.</FieldDescription>
              {error && <FieldError>{error.message}</FieldError>}
            </Field>
            {mints.length === 0 && (
              <Alert>
                <TriangleAlert />
                <AlertTitle>A mint is required</AlertTitle>
                <AlertDescription>Add a trusted mint in the panel beside this one before sending.</AlertDescription>
              </Alert>
            )}
            <Button className="h-10" onClick={handleSend} disabled={isSending || !amount || mints.length === 0}>
              {isSending ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
              {isSending ? "Creating token…" : "Create token"}
            </Button>
          </FieldGroup>
        )}
      </CardContent>
    </Card>
  );
}
