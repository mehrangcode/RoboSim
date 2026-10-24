import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { NotFound, RootLayout } from './routes/root.js';

// Pages are lazy chunks: the gate and sign-in form load first (NFR-PERF-04 budget).
const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/workspaces' });
  },
});
const plansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plans',
  component: lazyRouteComponent(() => import('./plans/plans-page.js'), 'PlansPage'),
});
// `?q=` keeps the search in the URL, so the back button returns to the same results.
const workspacesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces',
  validateSearch: (search: Record<string, unknown>): { q?: string } =>
    typeof search['q'] === 'string' && search['q'] ? { q: search['q'] } : {},
  component: lazyRouteComponent(() => import('./workspaces/workspaces-page.js'), 'WorkspacesPage'),
});
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces/$id',
  component: lazyRouteComponent(() => import('./workspaces/workspace-detail-page.js'), 'WorkspaceDetailPage'),
});
const routeTree = rootRoute.addChildren([indexRoute, plansRoute, workspacesRoute, workspaceRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
