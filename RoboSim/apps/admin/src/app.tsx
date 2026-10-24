import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, type RouterHistory } from '@tanstack/react-router';
import type { i18n as I18nInstance } from 'i18next';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { adminApi, type AdminClient } from './lib/admin-api.js';
import { ApiError } from './lib/api.js';
import { createAppRouter } from './router.js';
import { ClientContext } from './session/session.js';

export function App({
  i18n,
  history,
  client,
}: {
  i18n: I18nInstance;
  history?: RouterHistory;
  client?: AdminClient;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Problems (4xx/5xx with a body) are answers, not glitches: only retry network failures.
        defaultOptions: { queries: { retry: (count, e) => !(e instanceof ApiError) && count < 2 } },
      }),
  );
  const [router] = useState(() => createAppRouter(history));
  const [fallback] = useState(() => adminApi(() => i18n.language));
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ClientContext value={client ?? fallback}>
          <RouterProvider router={router} />
        </ClientContext>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
