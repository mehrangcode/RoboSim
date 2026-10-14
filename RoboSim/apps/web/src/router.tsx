import { createRootRoute, createRoute, createRouter, type RouterHistory } from '@tanstack/react-router';
import { Home } from './routes/home.js';
import { NotFound, RootLayout } from './routes/root.js';

const rootRoute = createRootRoute({ component: RootLayout, notFoundComponent: NotFound });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home });
const routeTree = rootRoute.addChildren([homeRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
