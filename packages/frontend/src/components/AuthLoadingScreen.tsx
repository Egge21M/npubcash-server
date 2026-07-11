import { useEffect, useState } from "react";
import { Radio, X } from "lucide-react";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export function AuthLoadingScreen({ onClearSession }: { onClearSession: () => void }) {
  const [showClearButton, setShowClearButton] = useState(false);
  useEffect(() => { const timeout = window.setTimeout(() => setShowClearButton(true), 2000); return () => window.clearTimeout(timeout); }, []);

  return (
    <div className="brand-grid flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-7">
        <Brand />
        <Card className="w-full border-primary/20 shadow-xl shadow-primary/10">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <span className="relative flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"><Radio /><Spinner className="absolute -right-1 -top-1 text-primary" /></span>
            <div className="flex flex-col gap-1"><span className="font-medium">Reconnecting securely</span><span className="text-sm text-muted-foreground">Restoring your remote signer session…</span></div>
          </CardContent>
        </Card>
        <Button variant="ghost" size="sm" onClick={onClearSession} className={showClearButton ? "opacity-100" : "pointer-events-none opacity-0"}>
          <X data-icon="inline-start" />Clear saved session
        </Button>
      </div>
    </div>
  );
}
