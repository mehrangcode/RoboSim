import {
  STOCK_STATUSES,
  baseKeyOf,
  partKey,
  type CatalogPrice,
  type PriceablePart,
  type StockStatus,
} from '@robosim/shared';
import { Button, Card } from '@robosim/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lib/format.js';
import { useClient } from '../session/session.js';
import { useProblemText } from '../ui/form-utils.js';
import { Field, FormError, LoadError, Loading, Select, inputClass } from '../ui/form.js';

export const PRICES_KEY = ['admin', 'prices'] as const;

/** Price list behind the BOM (FR-BOM-02): one row per part, plus rows for variants priced on their own. */
export function PricesPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const client = useClient();
  const prices = useQuery({ queryKey: PRICES_KEY, queryFn: () => client.prices() });
  const [filter, setFilter] = useState('');
  const name = usePartName();
  const needle = filter.trim().toLowerCase();
  const parts = (prices.data?.parts ?? []).filter(
    (p) => !needle || p.key.includes(needle) || name(p).toLowerCase().includes(needle),
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('admin:prices.title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('admin:prices.intro')}</p>
        {prices.data?.asOf && (
          <p className="mt-1 text-sm text-ink-muted">
            {t('admin:prices.asOf', { date: fmt.date(prices.data.asOf) })}
          </p>
        )}
      </header>
      {prices.isPending && <Loading />}
      {prices.error && <LoadError error={prices.error} onRetry={() => void prices.refetch()} />}
      {prices.data && (
        <Card className="flex flex-col gap-4 p-4 sm:p-6">
          <input
            type="search"
            aria-label={t('admin:prices.filter')}
            placeholder={t('admin:prices.filter')}
            className={`${inputClass} max-w-sm`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-start text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th className="px-2 py-1 text-start font-medium">{t('admin:prices.col.part')}</th>
                  <th className="px-2 py-1 text-start font-medium">{t('admin:prices.col.price')}</th>
                  <th className="px-2 py-1 text-start font-medium">{t('admin:prices.col.stock')}</th>
                  <th className="px-2 py-1 text-start font-medium">{t('admin:prices.col.updated')}</th>
                  <th className="px-2 py-1">
                    <span className="sr-only">{t('admin:prices.col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {parts.map((part) => (
                  <PartRows key={part.key} part={part} items={prices.data.items} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function usePartName() {
  const { t } = useTranslation();
  return (p: PriceablePart): string =>
    p.kind === 'board'
      ? t(`admin:board.${p.key.slice('board:'.length)}`)
      : p.kind === 'jumper'
        ? t(`admin:prices.jumper.${p.key.slice('consumable.jumper-'.length)}`)
        : p.nameKey
          ? t(`components:${p.nameKey}`)
          : p.key;
}

function PartRows({ part, items }: { part: PriceablePart; items: readonly CatalogPrice[] }) {
  const { t } = useTranslation();
  const name = usePartName();
  const [adding, setAdding] = useState(false);
  const own = items.find((p) => p.partKey === part.key);
  const variants = items.filter((p) => p.partKey !== part.key && baseKeyOf(p.partKey) === part.key);
  return (
    <>
      <PriceRow
        label={name(part)}
        sub={part.key}
        partKey={part.key}
        price={own}
        extra={
          part.variantProps.length > 0 &&
          !adding && (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              {t('admin:prices.addVariant')}
            </Button>
          )
        }
      />
      {variants.map((v) => (
        <PriceRow
          key={v.partKey}
          label={v.partKey.slice(part.key.length + 1).replaceAll('&', ', ')}
          sub={null}
          partKey={v.partKey}
          price={v}
          indent
        />
      ))}
      {adding && (
        <tr>
          <td colSpan={5} className="px-2 py-2 ps-8">
            <VariantForm part={part} onDone={() => setAdding(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

function PriceRow({
  label,
  sub,
  partKey: key,
  price,
  indent = false,
  extra,
}: {
  label: string;
  sub: string | null;
  partKey: string;
  price: CatalogPrice | undefined;
  indent?: boolean;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const client = useClient();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const remove = useMutation({
    mutationFn: () => client.removePrice(key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PRICES_KEY }),
  });
  const problemText = useProblemText();

  if (editing)
    return (
      <tr>
        <td colSpan={5} className={`px-2 py-2 ${indent ? 'ps-8' : ''}`}>
          <p className="mb-2 font-medium">{label}</p>
          <PriceForm partKey={key} price={price} onDone={() => setEditing(false)} />
        </td>
      </tr>
    );
  return (
    <tr>
      <td className={`px-2 py-2 ${indent ? 'ps-8' : ''}`}>
        <div className="font-medium">{label}</div>
        {sub && (
          <div className="font-mono text-xs text-ink-muted" dir="ltr">
            {sub}
          </div>
        )}
      </td>
      <td className="px-2 py-2">
        {price ? fmt.price(price.priceIrr) : <span className="text-ink-muted">—</span>}
      </td>
      <td className="px-2 py-2">{price ? t(`admin:prices.stock.${price.stock}`) : ''}</td>
      <td className="px-2 py-2 text-ink-muted">{price ? fmt.date(price.updatedAt) : ''}</td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(true)}
            aria-label={t('admin:prices.editOf', { part: label })}
          >
            {price ? t('admin:prices.edit') : t('admin:prices.set')}
          </Button>
          {price && (
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              aria-label={t('admin:prices.removeOf', { part: label })}
            >
              {t('admin:prices.remove')}
            </Button>
          )}
          {extra}
        </div>
        {remove.error && <FormError text={problemText(remove.error)} />}
      </td>
    </tr>
  );
}

function PriceForm({
  partKey: key,
  price,
  onDone,
}: {
  partKey: string;
  price: CatalogPrice | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const client = useClient();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const id = useId();
  const [amount, setAmount] = useState(price?.priceIrr === null || !price ? '' : String(price.priceIrr));
  const [stock, setStock] = useState<StockStatus>(price?.stock ?? 'in_stock');
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: (priceIrr: number | null) => client.setPrice(key, { priceIrr, stock }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PRICES_KEY });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = amount.trim();
    const value = text === '' ? null : Number(text);
    if (value !== null && (!Number.isInteger(value) || value < 0)) return setInvalid(true);
    setInvalid(false);
    save.mutate(value);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <Field
        id={`${id}-price`}
        label={t('admin:prices.priceLabel')}
        hint={t('admin:prices.priceHint')}
        inputMode="numeric"
        dir="ltr"
        value={amount}
        aria-invalid={invalid}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Select
        id={`${id}-stock`}
        label={t('admin:prices.col.stock')}
        value={stock}
        onChange={(e) => setStock(e.target.value as StockStatus)}
      >
        {STOCK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`admin:prices.stock.${s}`)}
          </option>
        ))}
      </Select>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={save.isPending}>
          {t('admin:prices.save')}
        </Button>
        <Button size="sm" variant="secondary" type="button" onClick={onDone}>
          {t('admin:actions.cancel')}
        </Button>
      </div>
      <div className="basis-full">
        <FormError
          text={invalid ? t('admin:prices.priceInvalid') : save.error ? problemText(save.error) : null}
        />
      </div>
    </form>
  );
}

/** Picks the variant (prop values) first; the price form then saves that key. */
function VariantForm({ part, onDone }: { part: PriceablePart; onDone: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [key, setKey] = useState<string | null>(null);
  if (key) return <PriceForm partKey={key} price={undefined} onDone={onDone} />;
  const complete = part.variantProps.every((p) => values[p]?.trim());
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete)
          setKey(
            partKey(part.key, Object.fromEntries(part.variantProps.map((p) => [p, values[p]?.trim() ?? '']))),
          );
      }}
    >
      {part.variantProps.map((p) => (
        <Field
          key={p}
          id={`${id}-${p}`}
          label={p}
          dir="ltr"
          value={values[p] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))}
        />
      ))}
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={!complete}>
          {t('admin:prices.next')}
        </Button>
        <Button size="sm" variant="secondary" type="button" onClick={onDone}>
          {t('admin:actions.cancel')}
        </Button>
      </div>
    </form>
  );
}
