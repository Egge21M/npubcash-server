import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedHistory } from "coco-cashu-react";
import { ArrowLeft, ArrowRight, Wallet } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { TransactionList } from "@/components/TransactionList";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authed/history")({ component: History });

function History() {
  const [page, setPage] = useState(0);
  const { history, hasMore, isFetching, goToPage } = usePaginatedHistory(25);

  const changePage = async (nextPage: number) => {
    await goToPage(nextPage);
    setPage(nextPage);
  };

  return (
    <div className="flex flex-col gap-8 pb-10">
      <PageHeader
        eyebrow="Wallet activity"
        title="Transaction history"
        description="A complete, chronological view of funds moving in and out of your wallet."
        action={<Button nativeButton={false} render={<Link to="/wallet" />} variant="outline"><Wallet data-icon="inline-start" />Back to wallet</Button>}
      />
      <Card>
        <CardHeader>
          <CardTitle>All transactions</CardTitle>
          <CardDescription>Page {page + 1} · Up to 25 entries per page</CardDescription>
        </CardHeader>
        <CardContent><TransactionList history={history} isFetching={isFetching} /></CardContent>
      </Card>
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={() => changePage(page - 1)} disabled={page === 0 || isFetching}>
          <ArrowLeft data-icon="inline-start" />Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button variant="outline" onClick={() => changePage(page + 1)} disabled={!hasMore || isFetching}>
          Next<ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}
