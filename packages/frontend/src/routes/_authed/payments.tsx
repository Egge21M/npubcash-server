import { useEffect, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedHistory } from "coco-cashu-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BarChart3, CalendarDays, Wallet } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

const WEEK_COUNT = 26;
const DAYS_IN_WEEK = 7;
const MS_IN_DAY = 24 * 60 * 60 * 1000;
const MS_IN_WEEK = DAYS_IN_WEEK * MS_IN_DAY;

const chartConfig = {
  amount: {
    label: "Incoming sats",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

function startOfWeek(date: Date) {
  const dayOfWeek = date.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function buildWeekStarts(reference: Date) {
  const currentWeekStart = startOfWeek(reference);
  return Array.from({ length: WEEK_COUNT }, (_, index) => {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(
      currentWeekStart.getDate() - (WEEK_COUNT - 1 - index) * DAYS_IN_WEEK
    );
    return weekStart;
  });
}

function formatWeekLabel(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export const Route = createFileRoute("/_authed/payments")({
  component: Payments,
});


function Payments() {
  const { history, hasMore, isFetching, loadMore } = usePaginatedHistory(100);
  const now = useMemo(() => new Date(), []);
  const weekStarts = useMemo(() => buildWeekStarts(now), [now]);
  const cutoffTimestamp = weekStarts[0]?.getTime() ?? now.getTime();
  const endTimestamp =
    (weekStarts[weekStarts.length - 1]?.getTime() ?? now.getTime()) +
    MS_IN_WEEK;

  const oldestTimestamp = useMemo(() => {
    if (history.length === 0) {
      return Number.POSITIVE_INFINITY;
    }

    return history.reduce(
      (min, entry) => Math.min(min, entry.createdAt),
      Number.POSITIVE_INFINITY
    );
  }, [history]);

  useEffect(() => {
    if (
      !isFetching &&
      hasMore &&
      history.length > 0 &&
      oldestTimestamp > cutoffTimestamp
    ) {
      void loadMore();
    }
  }, [cutoffTimestamp, hasMore, history.length, isFetching, loadMore, oldestTimestamp]);

  const { chartData, hasMintData, totalReceived } = useMemo(() => {
    const totals = new Map<number, number>();
    weekStarts.forEach((weekStart) => {
      totals.set(weekStart.getTime(), 0);
    });

    let hasMintData = false;

    for (const entry of history) {
      if (entry.type !== "mint") {
        continue;
      }

      if (entry.createdAt < cutoffTimestamp || entry.createdAt >= endTimestamp) {
        continue;
      }

      hasMintData = true;
      const weekStart = startOfWeek(new Date(entry.createdAt)).getTime();
      const currentTotal = totals.get(weekStart);
      if (currentTotal !== undefined) {
        totals.set(weekStart, currentTotal + entry.amount);
      }
    }

    const chartData = weekStarts.map((weekStart) => ({
      week: formatWeekLabel(weekStart),
      amount: totals.get(weekStart.getTime()) ?? 0,
    }));

    const totalReceived = chartData.reduce((sum, week) => sum + week.amount, 0);
    return { chartData, hasMintData, totalReceived };
  }, [cutoffTimestamp, endTimestamp, history, weekStarts]);

  return (
    <div className="flex flex-col gap-8 pb-10">
      <PageHeader
        eyebrow="Wallet insights"
        title="Incoming payments"
        description="See the rhythm of your Lightning income across the last six months."
        action={<Button nativeButton={false} render={<Link to="/wallet" />} variant="outline"><Wallet data-icon="inline-start" />Back to wallet</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Received in 26 weeks</CardDescription>
            <CardTitle className="text-2xl">{totalReceived.toLocaleString()} sats</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Weekly average</CardDescription>
            <CardTitle className="text-2xl">{Math.round(totalReceived / WEEK_COUNT).toLocaleString()} sats</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"><BarChart3 /></div>
          <CardTitle>Six-month overview</CardTitle>
          <CardDescription>Incoming Lightning payments grouped by week.</CardDescription>
          <Badge variant="outline" className="w-fit"><CalendarDays data-icon="inline-start" />26 weeks</Badge>
        </CardHeader>
        <CardContent>
          {isFetching && history.length === 0 ? (
            <Skeleton className="h-[360px] w-full rounded-xl md:h-[420px]" />
          ) : !hasMintData ? (
            <Empty className="min-h-80 border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><BarChart3 /></EmptyMedia>
                <EmptyTitle>No incoming payments yet</EmptyTitle>
                <EmptyDescription>Your weekly chart will come to life after your first Lightning payment.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ChartContainer
                config={chartConfig}
                className="h-[360px] w-full aspect-auto md:h-[420px]"
            >
                <BarChart data={chartData} margin={{ left: 12, right: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="week"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    interval={2}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => `Week of ${value}`}
                      />
                    }
                  />
                  <Bar dataKey="amount" fill="var(--color-amount)" radius={[8, 8, 2, 2]} />
                </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
