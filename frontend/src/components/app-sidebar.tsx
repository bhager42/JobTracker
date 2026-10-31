import { Link } from '@tanstack/react-router'
import {
  BarChart3,
  BriefcaseBusiness,
  CodeXml,
  FileText,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
} from 'lucide-react'

import { useAuthStatus, useLogout } from '@/api/auth'
import { useHealth } from '@/api/client'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/applications', label: 'Applications', icon: ListChecks },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/metrics', label: 'Metrics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

const SOURCE_URL = 'https://github.com/bhager42/JobTracker'

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <BriefcaseBusiness className="size-4" />
                </div>
                <span className="font-semibold tracking-tight">JobTracker</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton asChild tooltip={label}>
                    <Link
                      to={to}
                      activeOptions={{ exact: to === '/' }}
                      activeProps={{ 'data-active': true }}
                    >
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SourceCode />
        <SignOut />
        <ApiStatus />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function ApiStatus() {
  const { data, isError, isPending } = useHealth()
  const ok = data?.status === 'ok'
  const label = isPending ? 'Connecting…' : isError ? 'API unreachable' : `v${data.version}`
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center">
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          isPending ? 'bg-muted-foreground/40' : ok ? 'bg-emerald-500' : 'bg-red-500',
        )}
        aria-hidden
      />
      <span className="group-data-[collapsible=icon]:hidden">{label}</span>
    </div>
  )
}

// AGPL-3.0 §13: offer the source to everyone using the app over the network.
function SourceCode() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip="Source code">
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            <CodeXml />
            <span>Source code</span>
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function SignOut() {
  const status = useAuthStatus()
  const logout = useLogout()
  if (!status.data?.enabled) return null
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip="Sign out"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          <LogOut />
          <span>Sign out</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
