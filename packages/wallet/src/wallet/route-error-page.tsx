import { CircleAlertIcon } from "lucide-react"
import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { PageFrame } from "./wallet-session-screens"

export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "The page could not be displayed."

  return (
    <PageFrame>
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Link className={buttonVariants({ variant: "outline" })} to="/">
        Return home
      </Link>
    </PageFrame>
  )
}
