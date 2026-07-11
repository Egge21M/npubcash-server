import { Link } from "@tanstack/react-router";
import { usePaginatedHistory } from "coco-cashu-react";
import { ArrowRight, BarChart3 } from "lucide-react";
import { TransactionList } from "@/components/TransactionList";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function HistoryCard() {
  const { history, isFetching } = usePaginatedHistory(5);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Your latest wallet movements.</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto"><TransactionList history={history} isFetching={isFetching} /></CardContent>
      <CardFooter className="flex-wrap justify-between gap-2">
        <Button nativeButton={false} render={<Link to="/history" />} variant="ghost" size="sm">
          All activity<ArrowRight data-icon="inline-end" />
        </Button>
        <Button nativeButton={false} render={<Link to="/payments" />} variant="ghost" size="sm">
          <BarChart3 data-icon="inline-start" />Insights
        </Button>
      </CardFooter>
    </Card>
  );
}
