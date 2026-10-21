import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  type RouterHistory,
} from '@tanstack/react-router';
import type * as AuthPages from './auth/auth-pages.js';
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
// A cloud project in the editor (API Spec §4.4); the same lazy chunk as /editor.
const cloudEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/editor/$projectId',
  component: lazyRouteComponent(() => import('./editor/editor-page.js'), 'EditorPage'),
});
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: lazyRouteComponent(() => import('./projects/projects-page.js'), 'ProjectsPage'),
});
// Sign-in pages share one lazy chunk. `redirect` (a same-site path) is where sign-in returns to; `token` comes
// from emailed links.
const authSearch = (search: Record<string, unknown>): { redirect?: string; token?: string } => ({
  ...(typeof search['redirect'] === 'string' ? { redirect: search['redirect'] } : {}),
  ...(typeof search['token'] === 'string' ? { token: search['token'] } : {}),
});
type AuthPageName = keyof typeof AuthPages;
const authPage = <const Path extends string>(path: Path, name: AuthPageName) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    validateSearch: authSearch,
    component: lazyRouteComponent(() => import('./auth/auth-pages.js'), name),
  });
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: lazyRouteComponent(() => import('./auth/account-page.js'), 'AccountPage'),
});
const devMailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/mail',
  component: lazyRouteComponent(() => import('./auth/dev-mail-page.js'), 'DevMailPage'),
});
const routeTree = rootRoute.addChildren([
  homeRoute,
  projectsRoute,
  editorRoute,
  cloudEditorRoute,
  labRoute,
  authPage('/login', 'LoginPage'),
  authPage('/register', 'RegisterPage'),
  authPage('/forgot-password', 'ForgotPasswordPage'),
  authPage('/reset-password', 'ResetPasswordPage'),
  authPage('/verify-email', 'VerifyEmailPage'),
  accountRoute,
  devMailRoute,
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
