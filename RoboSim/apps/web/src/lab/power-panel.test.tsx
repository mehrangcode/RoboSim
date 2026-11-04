import { blankProject } from '@robosim/circuit-canvas';
import type { EnergyView, FindingView } from '@robosim/sim-runtime/client';
import { BOARD_PART, type ComponentInstance, type ProjectDocument } from '@robosim/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { MAX_SERIES, chartSeries } from './energy-series.js';
import { PowerPanel } from './power-panel.js';
import { POWER_SETTINGS_KEY, usePower } from './use-power.js';

const part = (id: string, type: string, props: ComponentInstance['props'] = {}): ComponentInstance => ({
  id,
  type,
  typeVersion: '1.0.0',
  x: 0,
  y: 0,
  rotation: 0,
  flipped: false,
  props,
});
const wire = (i: number, a: string, b: string) => {
  const [ap = '', apin = ''] = a.split('.');
  const [bp = '', bpin = ''] = b.split('.');
  return {
    id: `w${i}`,
    from: { part: ap, pin: apin },
    to: { part: bp, pin: bpin },
    color: 'red',
    points: [],
  };
};
const doc = (parts: ComponentInstance[], wires: [string, string][]): ProjectDocument => ({
  ...blankProject('Power', ''),
  components: parts,
  wires: wires.map(([a, b], i) => wire(i, a, b)),
});

/** 4×AA (2000 mAh) → AMS1117 3.3 V → a servo, plus a sonar on the board's 5 V pin. */
const robot = () =>
  doc(
    [
      part('pack', 'power.battery-4aa', { capacityMah: 2000 }),
      part('reg', 'semiconductor.ams1117-3v3'),
      part('servo', 'actuator.sg90-servo'),
      part('sonar', 'sensor.hc-sr04'),
    ],
    [
      ['pack.pos', 'reg.in'],
      ['reg.out', 'servo.vcc'],
      [`${BOARD_PART}.5V`, 'sonar.vcc'],
    ],
  );

const series = (values: number[]) => Float32Array.from(values);
function measured(over: Partial<EnergyView> = {}): EnergyView {
  return {
    session: 1,
    fromSlice: 0,
    upToSlice: 42_000,
    seconds: 42,
    parts: [
      { id: 'servo', avgMa: 180, peakMa: 1400, avgMw: 900, peakMw: 7000, joules: 37.8 },
      { id: 'sonar', avgMa: 15, peakMa: 16, avgMw: 75, peakMw: 80, joules: 3.15 },
      { id: 'reg', avgMa: 200, peakMa: 1405, avgMw: 300, peakMw: 2000, joules: 12.6 },
      { id: 'pack', avgMa: 0, peakMa: 0, avgMw: -1300, peakMw: -9000, joules: -54 },
    ],
    sources: [
      { id: 'pack', pin: 'pos', avgMa: 200, peakMa: 1405, p90Ma: 260, ratingMa: 3000, charge: 1 },
      { id: 'reg', pin: 'out', avgMa: 180, peakMa: 1400, p90Ma: 240, ratingMa: 800 },
      { id: '5V-rail', pin: 'pos', avgMa: 15, peakMa: 16, p90Ma: 15, ratingMa: 500 },
    ],
    mcuJoules: 0,
    bucketSeconds: 1,
    series: new Map([
      ['servo', series([1, 0.8, 0.9])],
      ['sonar', series([0.075, 0.075, 0.075])],
      ['reg', series([0.3, 0.3, 0.3])],
      ['pack', series([-1.3, -1.2, -1.2])],
    ]),
    ...over,
  };
}

async function setup({
  lng = 'en',
  energy = null,
  active = true,
  findings = [],
  d = robot(),
}: {
  lng?: 'en' | 'fa';
  energy?: EnergyView | null;
  active?: boolean;
  findings?: FindingView[];
  d?: ProjectDocument;
} = {}) {
  const i18n: I18n = await initI18n(lng);
  const energyOn = vi.fn<(on: boolean) => void>();
  const onShowFinding = vi.fn<(key: string) => void>();
  function Harness({ e, open }: { e: EnergyView | null; open: boolean }) {
    const power = usePower({ doc: d, sim: { energy: e, energyOn }, active: open, projectKey: 'p1' });
    return <PowerPanel doc={d} power={power} findings={findings} onShowFinding={onShowFinding} />;
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <Harness e={energy} open={active} />
    </I18nextProvider>,
  );
  const rerender = (e: EnergyView | null, open = active) =>
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <Harness e={e} open={open} />
      </I18nextProvider>,
    );
  return { energyOn, onShowFinding, rerender, user: userEvent.setup() };
}

/** Numbers are LTR isolates, so they stay whole in RTL. */
const iso = (text: string) => `\u2066${text}\u2069`;
const row = (id: string) =>
  screen.getByRole('rowheader', { name: new RegExp(`^${id}`) }).closest('tr') as HTMLElement;

beforeEach(() => localStorage.clear());

describe('power panel (FR-SIM-15, US-SIM-11)', () => {
  it('before a run shows a static estimate from typical currents, labelled estimate (AC3)', async () => {
    await setup();
    expect(screen.getByRole('radio', { name: 'Estimate' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radio', { name: /Measured/ })).toBeNull();
    expect(screen.getByTestId('power-basis')).toHaveTextContent(/typical current/);
    // A servo is a motor: 50 % of its 150 mA typical.
    expect(within(row('servo')).getByText(iso('75.00 mA'))).toBeInTheDocument();
    expect(within(row('servo')).getByLabelText('Duty of servo (%)')).toHaveValue(50);
    expect(screen.getByTestId('power-battery-pack')).toHaveTextContent(/pack — estimate/);
    expect(screen.getByTestId('power-battery-pack')).toHaveTextContent(/≈ \d+ h \d+ min \(/);
  });

  it('after a run the measured values replace it: avg and peak per part, a battery-life range (AC1, AC3)', async () => {
    const { rerender } = await setup();
    rerender(measured());
    expect(screen.getByRole('radio', { name: 'Measured (this run, 42 s)' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(row('servo')).getByText(iso('180.0 mA'))).toBeInTheDocument();
    expect(within(row('servo')).getByText(iso('1.400 A'))).toBeInTheDocument();
    expect(within(row('servo')).getByText(iso('37.80 J'))).toBeInTheDocument();
    const card = screen.getByTestId('power-battery-pack');
    expect(card).toHaveTextContent('pack — from this run');
    // 2000 mAh at 200 mA is 10 h × the usable fraction above the AMS1117's 4.4 V cut-off.
    const m = /≈ (\d+) h (\d+) min \((?:(\d+) h )?(\d+) min – (\d+) h (\d+) min\)/.exec(
      card.textContent ?? '',
    );
    expect(m, card.textContent ?? '').not.toBeNull();
    const hours = Number(m?.[1]) + Number(m?.[2]) / 60;
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThan(10);
    expect(card).toHaveTextContent(/Until \S*4\.4 V\S* at \S*200 mA/);
    expect(screen.getByRole('img', { name: /Stacked power of 3 series/ })).toBeInTheDocument();
  });

  it('marks a regulator over its rating and links to SAF-SUPPLY-OVERLOAD (AC2)', async () => {
    const finding: FindingView = {
      ruleId: 'SAF-SUPPLY-OVERLOAD',
      severity: 'error',
      kind: 'static',
      componentIds: ['reg', 'servo'],
      pinIds: [],
      messageKey: 'safety:SAF-SUPPLY-OVERLOAD',
      params: { supply: 'reg.out', ma: 1400, limit: 800 },
    };
    const { onShowFinding, user } = await setup({ energy: measured(), findings: [finding] });
    const reg = screen.getByTestId('power-supply-reg.out');
    expect(reg).toHaveTextContent('⚠ Peak over rating');
    expect(reg).toHaveTextContent(`peak ${iso('1.400 A')} · rated ${iso('800.0 mA')}`);
    await user.click(within(reg).getByRole('button', { name: 'Show the safety finding' }));
    expect(onShowFinding).toHaveBeenCalledWith('static:SAF-SUPPLY-OVERLOAD:reg,servo:');
    // The board 5 V pin is shown by its name and is fine.
    expect(screen.getByTestId('power-supply-board.5V')).toHaveTextContent(/^Board 5V/);
    expect(screen.getByTestId('power-supply-board.5V')).not.toHaveTextContent('rating');
  });

  it('keeps the duty per project in this browser', async () => {
    const { user } = await setup();
    const duty = within(row('servo')).getByLabelText('Duty of servo (%)');
    await user.clear(duty);
    await user.type(duty, '100');
    expect(within(row('servo')).getByText(iso('150.0 mA'))).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(POWER_SETTINGS_KEY) ?? '{}')).toMatchObject({
      duty: { p1: { servo: 1 } },
    });
  });

  it('records only while the tab is shown, unless every run is recorded', async () => {
    const { energyOn, rerender, user } = await setup({ active: false });
    expect(energyOn).toHaveBeenLastCalledWith(false);
    rerender(null, true);
    expect(energyOn).toHaveBeenLastCalledWith(true);
    rerender(null, false);
    expect(energyOn).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('checkbox', { name: 'Record power on every run' }));
    expect(energyOn).toHaveBeenLastCalledWith(true);
  });

  it('says since when it was opened mid-run', async () => {
    await setup({ energy: measured({ fromSlice: 42_000, seconds: 3 }) });
    expect(screen.getByRole('radio', { name: /Measured \(since .*00:42.*, 3 s\)/ })).toBeInTheDocument();
  });

  it('reads Persian digits in FA with numbers kept left-to-right', async () => {
    await setup({ lng: 'fa', energy: measured() });
    expect(within(row('servo')).getByText('⁦۱۸۰٫۰ mA⁩')).toBeInTheDocument();
  });
});

describe('chartSeries', () => {
  it('stacks the 7 biggest loads in document order and folds the rest into Other', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const map = new Map(ids.map((id, i) => [id, Float32Array.from([i + 1, i + 1])]));
    map.set('bat', Float32Array.from([-50, -50]));
    const out = chartSeries([...ids, 'bat'], map, 2, 'Other');
    expect(out).toHaveLength(MAX_SERIES);
    expect(out.map((s) => s.key).slice(0, 7)).toEqual(['p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
    expect(out.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out[7]?.label).toBe('Other');
    expect(Array.from(out[7]?.values ?? [])).toEqual([3, 3]); // (1 + 2 + 3) J / 2 s
  });
});
