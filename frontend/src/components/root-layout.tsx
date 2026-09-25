import { Link, Outlet } from '@tanstack/react-router'

import { AppCommandsProvider } from '@/components/app-commands'
import { AuthGate } from '@/components/auth-gate'
import { AppSidebar } from '@/components/app-sidebar'
import { SearchButton } from '@/components/search-button'
import { ThemeToggle } from '@/components/theme-toggle'
import { Toaster } from '@/components/ui/sonner'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

export function RootLayout() {
  return (
    <TooltipProvider>
      <AuthGate>
        <AppCommandsProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
                <SidebarTrigger className="-ml-1" />
                <div className="flex flex-1 justify-center">
                  <SearchButton />
                </div>
                <ThemeToggle />
              </header>
              {/* min-w-0 lets wide children (the board) scroll inside instead of widening the page. */}
              <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 space-y-6 p-4 md:p-8">
                <Outlet />
              </main>
            </SidebarInset>
          </SidebarProvider>
        </AppCommandsProvider>
      </AuthGate>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

export function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="mt-4 inline-block text-sm text-primary underline underline-offset-4">
        Back to dashboard
      </Link>
    </div>
  )
}
