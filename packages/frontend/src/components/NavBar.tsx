import { Link, useNavigate } from "@tanstack/react-router";
import { BarChart3, History, LogOut, Menu, Wallet } from "lucide-react";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const walletLinks = [
  { to: "/wallet" as const, label: "Wallet", icon: Wallet },
  { to: "/history" as const, label: "Activity", icon: History },
  { to: "/payments" as const, label: "Insights", icon: BarChart3 },
];

export function NavBar() {
  const { isAuthenticated, logout, isLoading } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    await navigate({ to: "/" });
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Brand />

        <div className="hidden items-center gap-3 md:flex">
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuLink
                  render={<Link to="/" />}
                  className={navigationMenuTriggerStyle()}
                >
                  Home
                </NavigationMenuLink>
              </NavigationMenuItem>
              {isAuthenticated &&
                walletLinks.map((item) => (
                  <NavigationMenuItem key={item.to}>
                    <NavigationMenuLink
                      render={<Link to={item.to} />}
                      className={navigationMenuTriggerStyle()}
                    >
                      {item.label}
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                ))}
            </NavigationMenuList>
          </NavigationMenu>
          {isAuthenticated ? (
            <Button variant="outline" onClick={handleLogout} disabled={isLoading}>
              <LogOut data-icon="inline-start" />
              Sign out
            </Button>
          ) : (
            <Button nativeButton={false} render={<Link to="/login" />}>
              <Wallet data-icon="inline-start" />
              Open wallet
            </Button>
          )}
        </div>

        <Sheet>
          <SheetTrigger
            render={
              <Button variant="outline" size="icon" className="md:hidden" />
            }
          >
            <Menu />
            <span className="sr-only">Open navigation</span>
          </SheetTrigger>
          <SheetContent className="w-[min(22rem,90vw)]">
            <SheetHeader>
              <SheetTitle><Brand /></SheetTitle>
              <SheetDescription>
                Your private, Nostr-native Lightning wallet.
              </SheetDescription>
            </SheetHeader>
            <nav className="flex flex-col gap-1 px-4">
              <SheetClose
                render={
                  <Link
                    to="/"
                    className={cn(navigationMenuTriggerStyle(), "justify-start")}
                  />
                }
              >
                Home
              </SheetClose>
              {isAuthenticated &&
                walletLinks.map((item) => (
                  <SheetClose
                    key={item.to}
                    render={
                      <Link
                        to={item.to}
                        className={cn(navigationMenuTriggerStyle(), "justify-start")}
                      />
                    }
                  >
                    <item.icon data-icon="inline-start" />
                    {item.label}
                  </SheetClose>
                ))}
            </nav>
            <div className="mt-auto p-4">
              {isAuthenticated ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleLogout}
                  disabled={isLoading}
                >
                  <LogOut data-icon="inline-start" />
                  Sign out
                </Button>
              ) : (
                <SheetClose render={<Button className="w-full" nativeButton={false} render={<Link to="/login" />} />}>
                  <Wallet data-icon="inline-start" />
                  Open wallet
                </SheetClose>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
