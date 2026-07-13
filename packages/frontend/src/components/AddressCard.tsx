import { useState } from "react";
import { npubEncode } from "nostr-tools/nip19";
import { Check, Copy, QrCode } from "lucide-react";
import { useNpcInfo } from "@/hooks/useNpcInfo";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

export function AddressCard() {
  const { info } = useNpcInfo();
  const { nostrConfig } = useAuth();
  const [copied, setCopied] = useState(false);
  const hostnameEnv = import.meta.env.NPC_HOSTNAME || "https://npub.cash";
  const hostname = new URL(hostnameEnv).hostname;
  const pubkey = info?.pubkey ?? nostrConfig?.pubkey;
  const identifier = info?.name || (pubkey ? npubEncode(pubkey) : null);
  const address = identifier ? `${identifier}@${hostname}` : "";

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
          <QrCode />
        </div>
        <CardTitle>Receive money</CardTitle>
        <CardDescription>Share this like any Lightning address.</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="wallet-address">Your address</FieldLabel>
            <InputGroup className="h-10">
              <InputGroupInput id="wallet-address" readOnly value={address} className="font-mono text-xs" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" onClick={handleCopy} aria-label="Copy address">
                  {copied ? <Check /> : <Copy />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription className="flex items-center justify-between gap-2">
              <span>Anyone can pay this address.</span>
              {copied && <Badge variant="secondary">Copied</Badge>}
            </FieldDescription>
          </Field>
        </FieldGroup>
        <Button variant="outline" className="mt-4 w-full" onClick={handleCopy} disabled={!address}>
          <Copy data-icon="inline-start" />
          Copy address
        </Button>
      </CardContent>
    </Card>
  );
}
