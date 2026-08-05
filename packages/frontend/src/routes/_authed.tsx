import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { CocoCashuProvider } from "coco-cashu-react";
import { RefreshCcw, TriangleAlert, Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { useWallet } from "@/hooks/useWallet";

export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context }) => { if (!context.auth.isAuthenticated) throw redirect({ to: "/login" }); },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { nostrConfig } = useAuth();
  const { manager, error, isLoading } = useWallet(nostrConfig);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"><Wallet /></span>
            <div className="flex flex-col gap-1"><span className="font-medium">Opening your wallet</span><span className="text-sm text-muted-foreground">Syncing mints and recent activity…</span></div>
            <Spinner className="text-primary" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg items-center">
        <Alert variant="destructive">
          <TriangleAlert /><AlertTitle>Wallet unavailable</AlertTitle><AlertDescription>{error}</AlertDescription>
          <Button variant="outline" className="mt-3" onClick={() => window.location.reload()}><RefreshCcw data-icon="inline-start" />Try again</Button>
        </Alert>
      </div>
    );
  }

  if (!manager) return null;
  return <CocoCashuProvider manager={manager}><Outlet /></CocoCashuProvider>;
}
