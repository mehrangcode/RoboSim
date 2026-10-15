import { breadboardLayout, type BreadboardLayout } from '@robosim/catalog/manifests';
import { memo, type ReactNode } from 'react';
import { GOLD, resistorBands } from './colors.js';
import { BOARD_FOOTPRINT, footprintOf, railHoleX, type Footprint } from './geometry.js';

/*
 * Hand-drawn part art in grid units (1 = 0.1"), origin at the footprint origin. Simple, recognisable
 * shapes; a designer's artwork can replace any entry without touching footprints.
 */

const LEG = '#9ca3af';
const PCB_BLUE = '#1f4e8c';
const PCB_RED = '#a3262a';
const TEXT = { fontFamily: 'ui-monospace, monospace', fontSize: 0.7 } as const;

const Leg = ({ from, to }: { from: readonly [number, number]; to: readonly [number, number] }) => (
  <line
    x1={from[0]}
    y1={from[1]}
    x2={to[0]}
    y2={to[1]}
    stroke={LEG}
    strokeWidth={0.18}
    strokeLinecap="round"
  />
);

const Label = ({
  x,
  y,
  children,
  size = 0.7,
  fill = '#fff',
  anchor = 'middle',
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
}) => (
  <text x={x} y={y} {...TEXT} fontSize={size} fill={fill} textAnchor={anchor} dominantBaseline="central">
    {children}
  </text>
);

/** Silkscreen markings (product names printed on the boards, not UI text). */
const SILK = {
  l298n: 'L298N',
  nineVolt: '9V',
  uno: 'UNO',
  hcSr04: 'HC-SR04',
  tcrt: 'TCRT5000',
  line: 'LINE ×3',
  plus: '+',
};
const SERVO_LEADS: readonly (readonly [string, number])[] = [
  ['#f97316', 0],
  ['#dc2626', 1],
  ['#78350f', 2],
];
const RAIL_LINES: readonly (readonly [number, string])[] = [
  [-0.6, '#3b82f6'],
  [1.6, '#ef4444'],
  [15.4, '#ef4444'],
  [17.6, '#3b82f6'],
];
const LED_FILL: Readonly<Record<string, string>> = {
  red: '#ef4444',
  yellow: '#facc15',
  green: '#22c55e',
  blue: '#3b82f6',
  white: '#f1f5f9',
};

export interface ArtProps {
  readonly type: string;
  readonly props: Readonly<Record<string, number | boolean | string>>;
  /** Live component state from the running simulation (LED brightness…). */
  readonly live?: unknown;
  readonly label: string;
}

function Resistor({ props }: ArtProps) {
  const bands = resistorBands(Number(props['ohms'] ?? 220));
  return (
    <>
      <Leg from={[0, 0]} to={[4, 0]} />
      <rect
        x={0.9}
        y={-0.42}
        width={2.2}
        height={0.84}
        rx={0.35}
        fill="#e3c997"
        stroke="#a88b55"
        strokeWidth={0.05}
      />
      {[...bands, GOLD].map((c, i) => (
        <rect
          key={i}
          x={1.15 + i * 0.45 + (i === 3 ? 0.25 : 0)}
          y={-0.42}
          width={0.22}
          height={0.84}
          fill={c}
        />
      ))}
    </>
  );
}

function Led({ props, live }: ArtProps) {
  const fill = LED_FILL[String(props['color'] ?? 'red')] ?? LED_FILL['red'];
  const glow = Math.min(
    1,
    Math.max(0, Number((live as { brightness?: number } | undefined)?.brightness ?? 0)),
  );
  return (
    <>
      <Leg from={[0, 0]} to={[0, -1.3]} />
      <Leg from={[1, 0]} to={[1, -1.3]} />
      {glow > 0 && (
        <circle cx={0.5} cy={-2.2} r={1.1 + glow * 1.4} fill={fill} opacity={0.25 + glow * 0.45} />
      )}
      <path
        d="M -0.35 -1.25 L -0.35 -2.3 A 0.85 0.85 0 0 1 1.35 -2.3 L 1.35 -1.25 Z"
        fill={fill}
        opacity={0.6 + glow * 0.4}
        stroke="#00000055"
        strokeWidth={0.06}
      />
      <rect x={-0.5} y={-1.35} width={2} height={0.22} fill={fill} opacity={0.8} />
    </>
  );
}

function Potentiometer() {
  return (
    <>
      <Leg from={[0, 0]} to={[0, -1]} />
      <Leg from={[2, 0]} to={[2, -1]} />
      <Leg from={[4, 0]} to={[4, -1]} />
      <rect x={-0.6} y={-4.2} width={5.2} height={3.4} rx={0.4} fill="#1e3a8a" />
      <circle cx={2} cy={-2.5} r={1.4} fill="#d1d5db" stroke="#6b7280" strokeWidth={0.08} />
      <line x1={2} y1={-2.5} x2={2} y2={-3.7} stroke="#374151" strokeWidth={0.2} />
    </>
  );
}

/** Live state fields, read defensively (the art also renders without a simulation). */
const liveNumber = (live: unknown, key: string): number | null => {
  const v = (live as Record<string, unknown> | null | undefined)?.[key];
  return typeof v === 'number' ? v : null;
};
const liveFlag = (live: unknown, key: string): boolean =>
  (live as Record<string, unknown> | null | undefined)?.[key] === true;

function PushButton({ live }: ArtProps) {
  const pressed = liveFlag(live, 'pressed');
  return (
    <>
      <rect x={-0.3} y={0.1} width={2.6} height={2.8} rx={0.2} fill="#374151" />
      <circle
        cx={1}
        cy={1.5}
        r={pressed ? 0.7 : 0.85}
        fill={pressed ? '#0ea5e9' : '#111827'}
        stroke="#9ca3af"
        strokeWidth={0.08}
      />
    </>
  );
}

function Ldr() {
  return (
    <>
      <Leg from={[0, 0]} to={[0.4, -1.2]} />
      <Leg from={[2, 0]} to={[1.6, -1.2]} />
      <circle cx={1} cy={-1.5} r={1.05} fill="#f5deb3" stroke="#b45309" strokeWidth={0.08} />
      <path d="M 0.3 -1.8 h 1.4 M 0.3 -1.5 h 1.4 M 0.3 -1.2 h 1.4" stroke="#b45309" strokeWidth={0.12} />
    </>
  );
}

function Buzzer({ live }: ArtProps) {
  const sounding = liveFlag(live, 'sounding');
  return (
    <>
      {sounding &&
        [2.6, 3.2].map((r) => (
          <circle
            key={r}
            cx={1.5}
            cy={-2}
            r={r}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={0.12}
            opacity={0.8}
          />
        ))}
      <circle cx={1.5} cy={-2} r={2.05} fill="#111827" />
      <circle cx={1.5} cy={-2} r={0.35} fill="#4b5563" />
      <Label x={0.1} y={-3.4} size={0.8}>
        {SILK.plus}
      </Label>
    </>
  );
}

function Switch({ live }: ArtProps) {
  const on = Boolean((live as { on?: boolean } | undefined)?.on);
  return (
    <>
      <Leg from={[0, 0]} to={[0, -0.5]} />
      <Leg from={[2, 0]} to={[2, -0.5]} />
      <rect x={-0.7} y={-2.2} width={3.4} height={1.7} rx={0.2} fill="#1f2937" />
      <rect x={on ? 1.1 : -0.1} y={-2.7} width={0.9} height={0.9} rx={0.1} fill="#e5e7eb" />
    </>
  );
}

function Module({
  fp,
  color,
  children,
  label,
}: {
  fp: Footprint;
  color: string;
  children?: ReactNode;
  label: string;
}) {
  const { x, y, w, h } = fp.box;
  return (
    <>
      <rect x={x} y={y} width={w} height={h - 0.5} rx={0.4} fill={color} />
      {children}
      {Object.entries(fp.pins).map(([name, [px, py]]) => (
        <g key={name}>
          <rect x={px - 0.4} y={py - 1.3} width={0.8} height={1} fill="#111" />
          <Label x={px} y={py - 1.9} size={0.45}>
            {name.toUpperCase()}
          </Label>
        </g>
      ))}
      <Label x={x + w / 2} y={y + 0.8} size={0.7}>
        {label}
      </Label>
    </>
  );
}

function HcSr04(p: ArtProps) {
  const fp = footprintOf(p.type);
  return (
    <Module fp={fp} color={PCB_BLUE} label={SILK.hcSr04}>
      {[-2.6, 5.6].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={-4.6} r={3} fill="#cbd5e1" stroke="#64748b" strokeWidth={0.1} />
          <circle cx={cx} cy={-4.6} r={2.1} fill="#334155" />
        </g>
      ))}
    </Module>
  );
}

function Tcrt5000(p: ArtProps) {
  return (
    <Module fp={footprintOf(p.type)} color={PCB_BLUE} label={SILK.tcrt}>
      <rect x={0} y={-10.2} width={3} height={2.2} rx={0.3} fill="#111" />
      <circle cx={0.8} cy={-9.1} r={0.55} fill="#60a5fa" />
      <circle cx={2.2} cy={-9.1} r={0.55} fill="#1f2937" />
    </Module>
  );
}

function Line3ch(p: ArtProps) {
  return (
    <Module fp={footprintOf(p.type)} color={PCB_BLUE} label={SILK.line}>
      {[-2, 2, 6].map((cx) => (
        <rect key={cx} x={cx - 1.2} y={-8.2} width={2.4} height={1.6} rx={0.3} fill="#111" />
      ))}
    </Module>
  );
}

function L298n(p: ArtProps) {
  const fp = footprintOf(p.type);
  const terminal = (x: number, y: number, w: number, h: number) => (
    <rect x={x} y={y} width={w} height={h} fill="#2563eb" rx={0.15} />
  );
  return (
    <>
      <rect x={0} y={0} width={17} height={17} rx={0.4} fill={PCB_RED} />
      <rect x={4} y={1} width={9} height={6} fill="#111827" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={4.5 + i * 1.2} y={1} width={0.6} height={6} fill="#374151" />
      ))}
      {terminal(-0.2, 5, 1.6, 4)}
      {terminal(15.6, 5, 1.6, 4)}
      {terminal(2, 14.4, 4, 2)}
      <rect x={7.5} y={15.6} width={7} height={1.2} fill="#111" />
      <Label x={8.5} y={9.5} size={1}>
        {SILK.l298n}
      </Label>
      {Object.entries(fp.pins).map(([name, [px, py]]) => (
        <Label
          key={name}
          x={px + (px === 0 ? 1.4 : px === 17 ? -1.4 : 0)}
          y={py === 17 ? 14.9 : py}
          size={0.5}
        >
          {name.toUpperCase()}
        </Label>
      ))}
    </>
  );
}

function TtMotor({ live }: ArtProps) {
  const rpm = liveNumber(live, 'rpm');
  return (
    <>
      <rect x={-10} y={-2.6} width={6.5} height={5.2} rx={0.4} fill="#facc15" />
      <rect x={-3.6} y={-2} width={3} height={4} rx={1} fill="#cbd5e1" />
      <Leg from={[-0.6, -1]} to={[0, -1]} />
      <Leg from={[-0.6, 1]} to={[0, 1]} />
      <circle cx={-6.8} cy={0} r={0.8} fill="#fff" />
      {rpm !== null && Math.abs(rpm) >= 0.5 && (
        <Label x={-6.8} y={-3.4} size={0.8} fill="#111">
          {`${Math.round(rpm)} rpm`}
        </Label>
      )}
    </>
  );
}

function Servo({ live }: ArtProps) {
  // Horn seen from above: 0° points right, 180° left.
  const a = ((liveNumber(live, 'angleDeg') ?? 90) * Math.PI) / 180;
  return (
    <>
      <rect x={-10} y={-1.8} width={6} height={5.6} rx={0.3} fill="#1d4ed8" />
      <line
        x1={-8.2}
        y1={1}
        x2={-8.2 + 2.6 * Math.cos(Math.PI - a)}
        y2={1 - 2.6 * Math.sin(Math.PI - a)}
        stroke="#f8fafc"
        strokeWidth={0.7}
        strokeLinecap="round"
      />
      <circle cx={-8.2} cy={1} r={1.3} fill="#f8fafc" />
      {SERVO_LEADS.map(([c, y]) => (
        <path key={y} d={`M -4 ${y} H 0`} stroke={c} strokeWidth={0.3} />
      ))}
    </>
  );
}

function Battery({ type }: ArtProps) {
  const four = type === 'power.battery-4aa';
  return (
    <>
      <rect x={four ? -12 : -9} y={-4} width={four ? 10.5 : 7.5} height={8} rx={0.5} fill="#111827" />
      {four ? (
        [0, 1, 2, 3].map((i) => (
          <rect key={i} x={-11.5} y={-3.6 + i * 1.95} width={9.5} height={1.6} rx={0.6} fill="#9ca3af" />
        ))
      ) : (
        <Label x={-5.2} y={0} size={1.4}>
          {SILK.nineVolt}
        </Label>
      )}
      <path d="M -1.5 -1 H 0" stroke="#dc2626" strokeWidth={0.3} />
      <path d="M -1.5 1 H 0" stroke="#111" strokeWidth={0.3} />
    </>
  );
}

function Chassis() {
  return (
    <>
      <rect
        x={-30}
        y={-24}
        width={60}
        height={48}
        rx={6}
        fill="#bae6fd55"
        stroke="#0369a1"
        strokeWidth={0.2}
      />
      <rect x={-6} y={-27} width={12} height={5} rx={1} fill="#111827" />
      <rect x={-6} y={22} width={12} height={5} rx={1} fill="#111827" />
      <circle cx={-24} cy={0} r={2} fill="#6b7280" />
    </>
  );
}

function Breadboard({ type }: ArtProps) {
  const layout = breadboardLayout(type) as BreadboardLayout;
  const fp = footprintOf(type);
  const { x, y, w, h } = fp.box;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={0.5} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={0.08} />
      <rect x={x} y={8.2} width={w} height={1.6} fill="#e2e8f0" />
      {RAIL_LINES.map(([ly, c]) => (
        <line
          key={ly}
          x1={railHoleX(layout, 1) - 0.5}
          x2={railHoleX(layout, layout.railHoles) + 0.5}
          y1={ly}
          y2={ly}
          stroke={c}
          strokeWidth={0.12}
        />
      ))}
      {Array.from({ length: Math.floor(layout.columns / 5) + 1 }, (_, i) => Math.max(1, i * 5)).map((c) => (
        <Label key={c} x={c} y={2.2} size={0.5} fill="#64748b">
          {c}
        </Label>
      ))}
      {Object.entries(fp.pins).map(([name, [px, py]]) => (
        <rect key={name} x={px - 0.22} y={py - 0.22} width={0.44} height={0.44} fill="#334155" />
      ))}
    </>
  );
}

function Generic({ type, label }: ArtProps) {
  const { x, y, w, h } = footprintOf(type).box;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={0.3} fill="#e5e7eb" stroke="#6b7280" strokeWidth={0.08} />
      <Label x={x + w / 2} y={y + h / 2} fill="#111" size={0.6}>
        {label}
      </Label>
    </>
  );
}

const ART: Readonly<Record<string, (p: ArtProps) => ReactNode>> = {
  'passive.resistor': Resistor,
  'actuator.led': Led,
  'passive.potentiometer': Potentiometer,
  'sensor.push-button': PushButton,
  'sensor.ldr': Ldr,
  'actuator.buzzer-active': Buzzer,
  'power.switch': Switch,
  'sensor.hc-sr04': HcSr04,
  'sensor.tcrt5000': Tcrt5000,
  'sensor.line-3ch': Line3ch,
  'driver.l298n': L298n,
  'actuator.tt-motor': TtMotor,
  'actuator.sg90-servo': Servo,
  'power.battery-4aa': Battery,
  'power.battery-9v': Battery,
  'mechanical.chassis-2wd': Chassis,
};

/** A part's drawing in grid units (the caller places, rotates and scales it). */
export const PartArt = memo(function PartArt(p: ArtProps) {
  const Art = ART[p.type] ?? (breadboardLayout(p.type) ? Breadboard : Generic);
  return <>{Art(p)}</>;
});

/** Arduino Uno R3 at the document origin. */
export const BoardArt = memo(function BoardArt() {
  const { w, h } = BOARD_FOOTPRINT.box;
  return (
    <>
      <rect x={0} y={0} width={w} height={h} rx={0.8} fill="#0f766e" />
      <rect x={-1.2} y={3} width={5.6} height={4.6} rx={0.2} fill="#cbd5e1" />
      <rect x={-0.8} y={13.5} width={5} height={3.6} rx={0.3} fill="#111827" />
      <rect x={11} y={8} width={11} height={3.2} rx={0.2} fill="#111827" />
      <rect x={8.4} y={0.4} width={16.2} height={1.2} fill="#111" />
      <rect x={10.4} y={19.4} width={13.2} height={1.2} fill="#111" />
      <Label x={16.5} y={14} size={1.6}>
        {SILK.uno}
      </Label>
      {Object.entries(BOARD_FOOTPRINT.pins).map(([id, [px, py]]) => (
        <Label key={id} x={px} y={py === 1 ? 2.6 : 18.4} size={0.5}>
          {id.startsWith('GND') ? 'GND' : id.replace(/^D/, '')}
        </Label>
      ))}
    </>
  );
});
