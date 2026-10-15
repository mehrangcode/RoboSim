import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory,
} from '@tanstack/react-router';
import { Home } from './routes/home.js';
import { NotFound, RootLayout } from './routes/root.js';

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home });
// The Lab pulls in the engine worker and renderer: a lazy chunk keeps them out of the initial bundle.
const labRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lab',
  component: lazyRouteComponent(() => import('./lab/lab-page.js'), 'LabPage'),
});
// The editor workspace (FR-WRK-01): lazy like the Lab; `?demo=<scenario>` opens a built-in demo.
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/editor',
  validateSearch: (search: Record<string, unknown>): { demo?: string } =>
    typeof search['demo'] === 'string' ? { demo: search['demo'] } : {},
  component: lazyRouteComponent(() => import('./editor/editor-page.js'), 'EditorPage'),
});
const routeTree = rootRoute.addChildren([homeRoute, editorRoute, labRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
