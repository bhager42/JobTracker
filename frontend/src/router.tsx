import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { NotFound, RootLayout } from '@/components/root-layout'
import { validateApplicationsSearch } from '@/lib/applications-search'
import { ApplicationDetailPage } from '@/pages/application-detail'
import { ApplicationsPage } from '@/pages/applications'
import { DashboardPage } from '@/pages/dashboard'
import { DocumentsPage } from '@/pages/documents'
import { MetricsPage } from '@/pages/metrics'
import { SettingsPage } from '@/pages/settings'

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound })

export const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/applications',
    component: ApplicationsPage,
    validateSearch: validateApplicationsSearch,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/applications/$id',
    component: ApplicationDetailPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/documents', component: DocumentsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/metrics', component: MetricsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage }),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
