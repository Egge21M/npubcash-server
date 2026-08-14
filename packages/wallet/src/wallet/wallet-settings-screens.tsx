import {
  ArrowLeftIcon,
  ChevronRightIcon,
  KeyRoundIcon,
  ShieldAlertIcon,
} from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item"
import { cn } from "@/lib/utils"
import { useWalletRuntime } from "./wallet-runtime-context"

export function SettingsPage() {
  const { signOut, state } = useWalletRuntime()

  if (state.phase !== "open") return null

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Wallet</p>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      <ItemGroup>
        <Item render={<Link to="/settings/recovery" />}>
          <ItemMedia variant="icon">
            <KeyRoundIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Recovery Phrase</ItemTitle>
            <ItemDescription>
              Review the phrase for this Wallet Installation.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <ChevronRightIcon />
          </ItemActions>
        </Item>
        <ItemSeparator />
        <Item>
          <ItemMedia variant="icon">
            <ShieldAlertIcon />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Nostr Signer</ItemTitle>
            <ItemDescription>
              {state.signerMode === "nip07"
                ? "NIP-07 browser extension"
                : state.signerMode === "direct-nsec"
                  ? "Direct nsec, encrypted at rest"
                  : "NIP-46 remote signer"}
            </ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>

      <Button variant="outline" onClick={() => void signOut()}>
        Sign Out
      </Button>
      <p className="text-sm text-muted-foreground">
        Sign Out forgets the signer configuration. Wallet Material stays in this
        browser for the next sign-in with the same Public Key.
      </p>
    </>
  )
}

export function RecoveryPage() {
  const { state } = useWalletRuntime()
  const [revealed, setRevealed] = useState(false)

  if (state.phase !== "open") return null

  return (
    <>
      <Link
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "self-start"
        )}
        to="/settings"
      >
        <ArrowLeftIcon data-icon="inline-start" />
        Settings
      </Link>

      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Wallet security</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Recovery Phrase
        </h1>
      </div>

      <Alert>
        <ShieldAlertIcon />
        <AlertTitle>Keep these words private</AlertTitle>
        <AlertDescription>
          Anyone with this phrase may recover Wallet keys. This release cannot
          import or restore the phrase, and it does not restore your Nostr
          signer or Activity.
        </AlertDescription>
      </Alert>

      {revealed ? (
        <Card>
          <CardHeader>
            <CardTitle>Your 12-word phrase</CardTitle>
            <CardDescription>
              Store it somewhere private, away from this browser.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {state.installation.recoveryPhrase
                .split(" ")
                .map((word, index) => (
                  <li
                    className="rounded-md bg-muted px-3 py-2 font-mono text-sm"
                    key={index}
                  >
                    <span className="mr-2 text-muted-foreground">
                      {index + 1}.
                    </span>
                    {word}
                  </li>
                ))}
            </ol>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => setRevealed(false)}>
              Hide phrase
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Dialog>
          <DialogTrigger render={<Button />}>
            Reveal recovery phrase
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reveal your Recovery Phrase?</DialogTitle>
              <DialogDescription>
                Make sure nobody can see or record your screen. Never paste
                these words into a website or send them to support.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              <DialogClose
                render={<Button />}
                onClick={() => setRevealed(true)}
              >
                Reveal phrase
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
