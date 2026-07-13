import { useEffect, useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import QRCode from "react-qr-code";
import { ArrowLeft, Check, Copy, KeyRound, Puzzle, Radio, RefreshCw, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { Brand } from "@/components/Brand";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) throw redirect({ to: "/wallet" });
  },
  component: Login,
});

function Login() {
  const {
    login,
    loginWithNip46,
    retryNip46Login,
    cancelNip46Login,
    nip46State,
    nip46Error,
    nip46URI,
    isAuthenticated,
    isLoading,
  } = useAuth();
  const router = useRouter();
  const [extensionError, setExtensionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      void router.navigate({ to: "/wallet", replace: true });
    }
  }, [isAuthenticated, router]);

  const handleExtensionLogin = async () => {
    setExtensionError(null);
    try { await login(); } catch (reason) {
      setExtensionError(reason instanceof Error ? reason.message : "Extension login failed");
    }
  };

  const handleNip46Login = () => {
    setExtensionError(null);
    loginWithNip46();
  };

  const handleCancelNip46 = () => { cancelNip46Login(); setCopied(false); };
  const copyToClipboard = async () => {
    if (!nip46URI) return;
    await navigator.clipboard.writeText(nip46URI);
    setCopied(true); window.setTimeout(() => setCopied(false), 2000);
  };
  const error = extensionError || nip46Error;

  if ((nip46State === "preparing" || nip46State === "awaiting" || nip46State === "error") && nip46URI) {
    const hasConnectionError = nip46State === "error";
    const isPreparing = nip46State === "preparing";
    return (
      <div className="mx-auto flex min-h-[calc(100vh-10rem)] max-w-lg items-center justify-center py-8">
        <Card className="w-full border-primary/20 shadow-xl shadow-primary/10">
          <CardHeader className="items-center text-center">
            <Badge variant="secondary">
              {hasConnectionError ? <TriangleAlert data-icon="inline-start" /> : isPreparing ? <Spinner /> : <Radio data-icon="inline-start" />}
              {hasConnectionError ? "Connection paused" : isPreparing ? "Connecting to relays" : "Waiting for signer"}
            </Badge>
            <CardTitle className="mt-3 text-2xl">
              {hasConnectionError ? "Resume the connection" : isPreparing ? "Preparing a secure connection" : "Scan or tap to connect"}
            </CardTitle>
            <CardDescription className="max-w-sm text-pretty">
              {hasConnectionError
                ? "The browser could not reach a connection relay. Resume listening, then open your signer again if needed."
                : "Open your Nostr signer, such as Amber or nsec.app. You can safely switch apps and return here."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-5">
            {hasConnectionError || isPreparing ? (
              <div className="rounded-2xl bg-white p-4 opacity-60 shadow-sm ring-1 ring-foreground/10" aria-hidden="true">
                <QRCode value={nip46URI} size={208} />
              </div>
            ) : (
              <a href={nip46URI} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-foreground/10" aria-label="Open connection in signer">
                <QRCode value={nip46URI} size={208} />
              </a>
            )}
            {hasConnectionError ? (
              <Button className="w-full" onClick={retryNip46Login}>
                <RefreshCw data-icon="inline-start" />Resume listening
              </Button>
            ) : isPreparing ? (
              <Button className="w-full" disabled>
                <Spinner data-icon="inline-start" />Connecting to relays
              </Button>
            ) : (
              <Button className="w-full" nativeButton={false} render={<a href={nip46URI} />}>
                <Smartphone data-icon="inline-start" />Open signer app
              </Button>
            )}
            {!hasConnectionError && !isPreparing && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Secure connection in progress</div>}
            {error && <Alert variant="destructive"><TriangleAlert /><AlertTitle>Could not connect</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          </CardContent>
          <CardFooter className="flex-col gap-2 sm:flex-row">
            <Button className="w-full" variant="outline" onClick={copyToClipboard}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button className="w-full" variant="outline" onClick={handleCancelNip46}>
              <ArrowLeft data-icon="inline-start" />Cancel
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100vh-10rem)] gap-10 py-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-16">
      <div className="flex max-w-xl flex-col gap-7">
        <Brand />
        <div className="flex flex-col gap-4">
          <Badge variant="secondary" className="w-fit"><ShieldCheck data-icon="inline-start" />Signer-first security</Badge>
          <h1 className="text-pretty text-4xl font-semibold tracking-tight sm:text-5xl">Your keys stay where they belong.</h1>
          <p className="text-pretty text-lg leading-8 text-muted-foreground">
            Connect a Nostr signer to unlock your wallet. npub.cash asks for signatures—it never asks for your private key.
          </p>
        </div>
        <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
          {["No password or recovery phrase to create", "Works with browser extensions and remote signers", "Disconnect at any time"].map((item) => (
            <li key={item} className="flex items-center gap-2"><Check className="text-primary" />{item}</li>
          ))}
        </ul>
      </div>

      <Card className="mx-auto w-full max-w-xl shadow-xl shadow-primary/5">
        <CardHeader>
          <CardTitle className="text-2xl">Choose your signer</CardTitle>
          <CardDescription>Both options connect to the same wallet.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && <Alert variant="destructive"><TriangleAlert /><AlertTitle>Sign in failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          <Button type="button" variant="outline" onClick={handleExtensionLogin} disabled={isLoading} className="h-auto w-full justify-start gap-4 rounded-2xl p-4 text-left whitespace-normal">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Puzzle /></span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium">Browser extension</span>
              <span className="text-sm text-muted-foreground">Alby, nos2x, or another NIP-07 extension</span>
            </span>
            {isLoading ? <Spinner /> : <KeyRound className="text-muted-foreground" />}
          </Button>
          <div className="flex items-center gap-3"><Separator className="flex-1" /><span className="text-xs uppercase tracking-widest text-muted-foreground">or</span><Separator className="flex-1" /></div>
          <Button type="button" variant="outline" onClick={handleNip46Login} disabled={isLoading} className="h-auto w-full justify-start gap-4 rounded-2xl p-4 text-left whitespace-normal">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><Smartphone /></span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium">Remote signer</span>
              <span className="text-sm text-muted-foreground">Any NIP-46 Nostr signer, including Amber or nsec.app</span>
            </span>
            <Radio className="text-muted-foreground" />
          </Button>
        </CardContent>
        <CardFooter className="justify-center text-center text-xs text-muted-foreground">By connecting, you authorize wallet-related Nostr signatures.</CardFooter>
      </Card>
    </div>
  );
}
