import { Button, Card } from '@robosim/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useProblemText } from '../ui/form-utils.js';
import { Field, FormError } from '../ui/form.js';
import { ME_KEY, useClient } from './session.js';
import { useSignOut } from './use-session.js';

function Centered({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md py-8">
      <Card>
        <h1 className="mb-4 text-xl font-bold tracking-tight">{title}</h1>
        {children}
      </Card>
    </div>
  );
}

export function SignInPage() {
  const { t } = useTranslation();
  const client = useClient();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await client.login({ email, password });
      await queryClient.refetchQueries({ queryKey: ME_KEY });
    } catch (err) {
      setError(problemText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered title={t('admin:signIn.title')}>
      <p className="mb-4 text-sm text-ink-muted">{t('admin:signIn.body')}</p>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field
          id="signin-email"
          label={t('admin:signIn.email')}
          type="email"
          autoComplete="username"
          dir="ltr"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          id="signin-password"
          label={t('admin:signIn.password')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError text={error} />
        <Button type="submit" disabled={busy}>
          {t('admin:signIn.submit')}
        </Button>
      </form>
    </Centered>
  );
}

export function NoAccessPage() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  return (
    <Centered title={t('admin:noAccess.title')}>
      <p className="mb-6 text-ink-muted">{t('admin:noAccess.body')}</p>
      <Button variant="secondary" onClick={() => void signOut()}>
        {t('admin:session.signOut')}
      </Button>
    </Centered>
  );
}
