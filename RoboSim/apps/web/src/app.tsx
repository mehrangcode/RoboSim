import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import type { i18n as I18nInstance } from 'i18next';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { AuthProvider } from './auth/auth-context.js';
import type { AuthClient } from './lib/auth-api.js';
import { createAppRouter } from './router.js';

export function App({
  i18n,
  history,
  auth,
}: {
  i18n: I18nInstance;
  history?: RouterHistory;
  auth?: AuthClient;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const [router] = useState(() => createAppRouter(history));
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider {...(auth ? { client: auth } : {})}>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
