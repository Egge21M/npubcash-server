import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  CircleDollarSign,
  CloudOff,
  Code2,
  Copy,
  Github,
  Landmark,
  LockKeyhole,
  MoveDown,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import { Brand } from "@/components/Brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/")({ component: HomePage });

const features = [
  {
    icon: CloudOff,
    eyebrow: "Always available",
    title: "Get paid while you sleep",
    description:
      "Your address keeps receiving even when your browser is closed. Claim the eCash whenever you come back.",
  },
  {
    icon: LockKeyhole,
    eyebrow: "Yours by design",
    title: "Identity is the account",
    description:
      "Funds are locked to your Nostr public key. No new password, recovery phrase, or account database required.",
  },
  {
    icon: CircleDollarSign,
    eyebrow: "Cashu-native",
    title: "Private digital cash",
    description:
      "Receive Lightning and hold it as Cashu eCash, with mint-level balances visible in one focused wallet.",
  },
  {
    icon: Code2,
    eyebrow: "Open protocols",
    title: "Built in the open",
    description:
      "Nostr, Lightning, and Cashu are composable public protocols. Inspect the code, run it, or build on top.",
  },
];

function HomePage() {
  return (
    <div className="-mx-4 -my-6 flex flex-col sm:-mx-6 sm:-my-8 lg:-mx-8">
      <HeroSection />
      <ProtocolStrip />
      <FeaturesSection />
      <HowItWorksSection />
      <ClosingSection />
      <Footer />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:px-8 lg:pb-28">
      <div className="brand-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <div className="flex max-w-3xl flex-col items-start gap-7">
          <Badge variant="secondary" className="rounded-full px-3 py-1">
            <Sparkles data-icon="inline-start" />
            Money for the open social web
          </Badge>
          <div className="flex flex-col gap-5">
            <h1 className="text-pretty text-5xl font-semibold tracking-[-0.045em] sm:text-6xl lg:text-7xl">
              Your Nostr identity is now a{" "}
              <span className="text-primary">Lightning address.</span>
            </h1>
            <p className="text-pretty max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
              Receive sats at your npub, hold private eCash, and take your wallet
              anywhere. No signup. No new identity. No compromise.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Button nativeButton={false} render={<Link to="/wallet" />} size="lg" className="h-11 px-5">
              <Wallet data-icon="inline-start" />
              Open your wallet
              <ArrowRight data-icon="inline-end" />
            </Button>
            <Button
              nativeButton={false}
              render={
                <a
                  href="https://docs.cashu-address.com/"
                  target="_blank"
                  rel="noreferrer"
                />
              }
              variant="outline"
              size="lg"
              className="h-11 px-5"
            >
              See how it works
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {["Nostr-native", "Open source", "Works offline"].map((item) => (
              <span key={item} className="inline-flex items-center gap-1.5">
                <Check className="text-primary" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </div>

        <WalletPreview />
      </div>
    </section>
  );
}

function WalletPreview() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:mx-0">
      <div className="absolute -inset-8 rounded-[3rem] bg-primary/10 blur-3xl" />
      <Card className="relative gap-6 border-primary/20 bg-card/90 p-2 shadow-2xl shadow-primary/10 backdrop-blur-xl">
        <CardHeader className="pt-3">
          <CardDescription>Available balance</CardDescription>
          <CardTitle className="text-4xl font-semibold tracking-tight">
            21,840 <span className="text-base font-normal text-muted-foreground">sats</span>
          </CardTitle>
          <CardAction>
            <Badge variant="secondary">Synced</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 rounded-2xl bg-muted/70 p-4">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Your address
            </span>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-mono text-sm font-medium">
                you@npub.cash
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Copy address">
                <Copy />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg">
              <Send data-icon="inline-start" />
              Send
            </Button>
            <Button variant="secondary" size="lg">
              <MoveDown data-icon="inline-start" />
              Receive
            </Button>
          </div>
          <Separator />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Recent activity</span>
              <span className="text-xs text-muted-foreground">Today</span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl bg-muted/50 p-3">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <Zap />
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Lightning received</span>
                  <span className="text-xs text-muted-foreground">npub.cash</span>
                </div>
              </div>
              <span className="text-sm font-semibold text-primary">+2,100 sats</span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-center text-xs text-muted-foreground">
          Preview wallet · Your balance will look different
        </CardFooter>
      </Card>
    </div>
  );
}

function ProtocolStrip() {
  return (
    <section className="border-y bg-card/70 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-sm font-medium text-muted-foreground">
          Three open protocols. One simple address.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge variant="outline"><Radio data-icon="inline-start" />Nostr identity</Badge>
          <span className="text-muted-foreground">+</span>
          <Badge variant="outline"><Zap data-icon="inline-start" />Lightning rails</Badge>
          <span className="text-muted-foreground">+</span>
          <Badge variant="outline"><CircleDollarSign data-icon="inline-start" />Cashu eCash</Badge>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto flex max-w-7xl flex-col gap-12">
        <div className="flex max-w-3xl flex-col gap-4">
          <Badge variant="secondary" className="w-fit">Built differently</Badge>
          <h2 className="text-pretty text-3xl font-semibold tracking-tight sm:text-5xl">
            A wallet that feels invisible until you need it.
          </h2>
          <p className="text-pretty text-lg leading-8 text-muted-foreground">
            npub.cash turns the identity you already use into a dependable way
            to receive money—without recreating the banking system around it.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {features.map((feature, index) => (
            <Card
              key={feature.title}
              className={index === 0 || index === 3 ? "bg-secondary/40" : undefined}
            >
              <CardHeader>
                <span className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <feature.icon />
                </span>
                <CardDescription>{feature.eyebrow}</CardDescription>
                <CardTitle className="text-xl">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-pretty leading-6 text-muted-foreground">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      icon: Send,
      number: "01",
      title: "Share your address",
      description: "Use your npub or claim a memorable username at npub.cash.",
    },
    {
      icon: Landmark,
      number: "02",
      title: "Receive over Lightning",
      description: "Payments are converted into Cashu eCash locked to your key.",
    },
    {
      icon: ShieldCheck,
      number: "03",
      title: "Claim on your terms",
      description: "Open the wallet and your funds are waiting—even if you were offline.",
    },
  ];

  return (
    <section className="border-y bg-muted/40 px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto flex max-w-7xl flex-col gap-12">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-end">
          <div className="flex flex-col gap-4">
            <Badge variant="outline" className="w-fit">From invoice to eCash</Badge>
            <h2 className="text-pretty text-3xl font-semibold tracking-tight sm:text-5xl">
              Lightning in. Private cash out.
            </h2>
          </div>
          <p className="text-pretty text-lg leading-8 text-muted-foreground lg:justify-self-end lg:max-w-xl">
            Cashu-Address bridges real-time Lightning payments with asynchronous,
            bearer-style eCash—so receiving doesn’t depend on being online.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {steps.map((step) => (
            <Card key={step.number}>
              <CardHeader>
                <CardAction>
                  <span className="font-mono text-sm text-muted-foreground">{step.number}</span>
                </CardAction>
                <span className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
                  <step.icon />
                </span>
                <CardTitle className="text-lg">{step.title}</CardTitle>
                <CardDescription className="text-pretty leading-6">
                  {step.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingSection() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
      <Card className="mx-auto max-w-7xl border-primary/20 bg-primary text-primary-foreground">
        <CardContent className="grid gap-10 p-8 sm:p-12 lg:grid-cols-[1fr_auto] lg:items-end lg:p-16">
          <div className="flex max-w-3xl flex-col gap-4">
            <span className="text-sm font-medium text-primary-foreground/70">Ready when you are</span>
            <h2 className="text-pretty text-3xl font-semibold tracking-tight sm:text-5xl">
              Your address already exists.
            </h2>
            <p className="text-pretty text-lg text-primary-foreground/75">
              Connect your Nostr signer and start receiving sats in under a minute.
            </p>
          </div>
          <Button nativeButton={false} render={<Link to="/wallet" />} variant="secondary" size="lg" className="h-11 px-5">
            Open wallet
            <ArrowRight data-icon="inline-end" />
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t bg-card/60 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <Brand />
          <p className="text-sm text-muted-foreground">Open money for the open social web.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            nativeButton={false}
            render={<a href="https://github.com/Egge21M/npubcash-server" target="_blank" rel="noreferrer" />}
            variant="outline"
          >
            <Github data-icon="inline-start" />
            GitHub
          </Button>
          <Button
            nativeButton={false}
            render={<a href="https://docs.cashu-address.com/" target="_blank" rel="noreferrer" />}
            variant="ghost"
          >
            Documentation
          </Button>
        </div>
      </div>
    </footer>
  );
}
