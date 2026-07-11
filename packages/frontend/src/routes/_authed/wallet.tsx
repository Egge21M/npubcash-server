import { createFileRoute } from "@tanstack/react-router";
import { AddressCard } from "@/components/AddressCard";
import { BalanceCard } from "@/components/BalanceCard";
import { BuyUsernameCard } from "@/components/BuyUsernameCard";
import { HistoryCard } from "@/components/HistoryCard";
import { MintsCard } from "@/components/MintsCard";
import { PageHeader } from "@/components/PageHeader";
import { SendCard } from "@/components/SendCard";

export const Route = createFileRoute("/_authed/wallet")({ component: Wallet });

function Wallet() {
  return (
    <div className="flex flex-col gap-8 pb-10">
      <PageHeader
        eyebrow="Personal wallet"
        title="Good to see you."
        description="Your balance, address, and latest activity—without the noise."
      />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3"><BalanceCard /></div>
        <div className="lg:col-span-2"><AddressCard /></div>
        <div className="lg:col-span-3"><SendCard /></div>
        <div className="lg:col-span-2"><MintsCard /></div>
        <div className="lg:col-span-2"><BuyUsernameCard /></div>
        <div className="lg:col-span-3"><HistoryCard /></div>
      </div>
    </div>
  );
}
