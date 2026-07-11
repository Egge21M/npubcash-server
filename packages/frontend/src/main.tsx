import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { AuthLoadingScreen } from "./components/AuthLoadingScreen";
import { TooltipProvider } from "./components/ui/tooltip";

import "./index.css";

const router = createRouter({
  routeTree,
  context: {
    auth: undefined!, // Will be set by InnerApp
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function InnerApp() {
  const auth = useAuth();

  // Don't render router until session restoration is complete
  if (auth.isRestoring) {
    return <AuthLoadingScreen onClearSession={auth.clearSession} />;
  }

  return <RouterProvider router={router} context={{ auth }} />;
}

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <TooltipProvider>
      <InnerApp />
    </TooltipProvider>
  </AuthProvider>
);
