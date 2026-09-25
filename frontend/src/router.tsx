import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'

import { NotFound, RootLayout } from '@/components/root-layout'
import { validateApplicationsSearch } from '@/lib/applications-search'
import { validateMetricsSearch } from '@/lib/metrics-search'
import { ApplicationsPage } from '@/pages/applications'
import { DashboardPage } from '@/pages/dashboard'

// The dashboard and list load with the app; heavier pages (charts, markdown, uploads) load
// on first visit.
const MetricsPage = lazyRouteComponent(() => import('@/pages/metrics'), 'MetricsPage')
const ApplicationDetailPage = lazyRouteComponent(
  () => import('@/pages/application-detail'),
  'ApplicationDetailPage',
)
const DocumentsPage = lazyRouteComponent(() => import('@/pages/documents'), 'DocumentsPage')
const SettingsPage = lazyRouteComponent(() => import('@/pages/settings'), 'SettingsPage')

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
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/metrics',
    component: MetricsPage,
    validateSearch: validateMetricsSearch,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage }),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
