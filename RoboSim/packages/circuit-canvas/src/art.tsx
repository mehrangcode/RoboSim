import { breadboardLayout, type BreadboardLayout } from '@robosim/catalog/manifests';
import { memo, type ReactNode } from 'react';
import { GOLD, resistorBands } from './colors.js';
import { capacitorCode } from './markings.js';
import { glyphRows } from './lcd-font.js';
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
  lm7805: 'L7805',
  ams1117: 'AMS1117',
  relay: 'SRD-05VDC',
  lm2596: 'LM2596',
  mg996r: 'MG996R',
  rgb: 'RGB',
  tb6612: 'TB6612FNG',
  l9110s: 'L9110S',
  stepper: '28BYJ-48',
  line5: 'LINE ×5',
  fc51: 'FC-51',
  pir: 'HC-SR501',
  ky038: 'KY-038',
  soil: 'SOIL',
  ky023: 'KY-023',
  ky040: 'KY-040',
  irf520: 'IRF520',
  ssd1306: 'SSD1306',
  gy521: 'GY-521',
  bmp280: 'BMP280',
  vl53l0x: 'VL53L0X',
  dht11: 'DHT11',
};
const IRF520_HEADER: readonly string[] = ['SIG', 'VCC', 'GND'];
/** IRF520 module screw-terminal silkscreen: name, y. */
const IRF520_TERMINALS: readonly (readonly [string, number])[] = [
  ['VIN', 0],
  ['GND', 1],
  ['V+', 3],
  ['V−', 4],
];
/** Keypad legends, row by row (printed on the keys). */
const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D'],
];
const keyInputName = (legend: string): string =>
  `key${legend === '*' ? 'Star' : legend === '#' ? 'Hash' : legend}`;
const STEPPER_WIRES: Readonly<Record<string, string>> = {
  blue: '#2563eb',
  pink: '#ec4899',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#dc2626',
};
/** LM2596 module terminal silkscreen: name, x, y. */
const BUCK_TERMINALS: readonly (readonly [string, number, number])[] = [
  ['IN+', 0, 2],
  ['IN−', 0, 6],
  ['OUT+', 17, 2],
  ['OUT−', 17, 6],
];
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

function Servo({ type, live }: ArtProps) {
  // Horn seen from above: 0° points right, 180° left. The MG996R is the same drawing, larger and black.
  const a = ((liveNumber(live, 'angleDeg') ?? 90) * Math.PI) / 180;
  const big = type === 'actuator.mg996r-servo';
  const [x, w, h, cx, horn] = big ? [-17, 13, 8, -14, 4] : [-10, 6, 5.6, -8.2, 2.6];
  return (
    <>
      <rect x={x} y={1 - h / 2} width={w} height={h} rx={0.3} fill={big ? '#111827' : '#1d4ed8'} />
      {big && (
        <Label x={x + w / 2 + 1.5} y={1} size={0.8}>
          {SILK.mg996r}
        </Label>
      )}
      <line
        x1={cx}
        y1={1}
        x2={cx + horn * Math.cos(Math.PI - a)}
        y2={1 - horn * Math.sin(Math.PI - a)}
        stroke="#f8fafc"
        strokeWidth={big ? 1 : 0.7}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={1} r={big ? 1.8 : 1.3} fill="#f8fafc" />
      {SERVO_LEADS.map(([c, y]) => (
        <path key={y} d={`M ${x + w} ${y} H 0`} stroke={c} strokeWidth={0.3} />
      ))}
    </>
  );
}

/** Axial diode: black epoxy (1N4007) or orange glass (1N4148, Zener), cathode band at `k`. */
function Diode({ type }: ArtProps) {
  const glass = type !== 'semiconductor.diode-1n4007';
  return (
    <>
      <Leg from={[0, 0]} to={[4, 0]} />
      <rect
        x={1.1}
        y={glass ? -0.32 : -0.45}
        width={1.8}
        height={glass ? 0.64 : 0.9}
        rx={0.15}
        fill={glass ? '#f59e0bcc' : '#1f2937'}
      />
      <rect
        x={2.5}
        y={glass ? -0.32 : -0.45}
        width={0.22}
        height={glass ? 0.64 : 0.9}
        fill={glass ? '#111' : '#d1d5db'}
      />
    </>
  );
}

/** Electrolytic marking: value in µF (`100µ`) and rating. */
const ufLabel = (uf: number): string => `${uf >= 10 ? Math.round(uf) : Math.round(uf * 10) / 10}µ`;

/** Ceramic disc capacitor with its value code. */
function CeramicCap({ props }: ArtProps) {
  return (
    <>
      <Leg from={[0, 0]} to={[0.6, -1.2]} />
      <Leg from={[2, 0]} to={[1.4, -1.2]} />
      <ellipse cx={1} cy={-1.5} rx={1.15} ry={0.95} fill="#d97706" />
      <Label x={1} y={-1.5} size={0.55}>
        {capacitorCode(Number(props['capacitanceNf'] ?? 100))}
      </Label>
    </>
  );
}

/**
 * Electrolytic can: the stripe marks the − lead. While running, a light band rises with the voltage
 * across it relative to its rating; a vented (damaged) can shows a split, bulging top.
 */
function ElectrolyticCap({ props, live }: ArtProps) {
  const volts = liveNumber(live, 'volts');
  const rated = liveNumber(live, 'ratedV') ?? 16;
  const vented = liveFlag(live, 'damaged');
  const level = volts === null ? 0 : Math.min(1, Math.max(0, volts / rated));
  const rating = String(props['ratedVoltage'] ?? 'v16')
    .slice(1)
    .replace('_', '.');
  return (
    <>
      <Leg from={[0, 0]} to={[0, -0.5]} />
      <Leg from={[1, 0]} to={[1, -0.5]} />
      <rect x={-0.6} y={-3.6} width={2.2} height={3.1} rx={0.3} fill="#1e3a8a" />
      {level > 0 && (
        <rect x={-0.6} y={-0.5 - 3.1 * level} width={1.5} height={3.1 * level} fill="#60a5fa66" />
      )}
      <rect x={0.95} y={-3.6} width={0.65} height={3.1} fill="#cbd5e1" />
      <Label x={1.27} y={-2.9} size={0.55} fill="#1e3a8a">
        −
      </Label>
      <Label x={0.2} y={-2.6} size={0.42}>
        {ufLabel(Number(props['capacitanceUf'] ?? 100))}
      </Label>
      <Label x={0.2} y={-1.6} size={0.38}>
        {`${rating}V`}
      </Label>
      {vented ? (
        <path
          d="M -0.6 -3.6 Q 0.5 -4.3 1.6 -3.6 M 0.1 -3.9 L 0.5 -3.6 L 0.9 -3.95"
          stroke="#78350f"
          strokeWidth={0.18}
          fill="none"
        />
      ) : (
        <path d="M 0.2 -3.6 V -3.3 M 0.8 -3.6 V -3.3" stroke="#94a3b8" strokeWidth={0.08} />
      )}
    </>
  );
}

/** Regulator: TO-220 with its tab (LM7805) or a small blue module (AMS1117); tints red as it heats. */
function Regulator({ type, live }: ArtProps) {
  const heat = Math.min(1, Math.max(0, ((liveNumber(live, 'junctionC') ?? 25) - 40) / 100));
  const shutdown = liveFlag(live, 'thermalShutdown');
  const to220 = type === 'semiconductor.lm7805';
  return (
    <>
      {[0, 1, 2].map((x) => (
        <Leg key={x} from={[x, 0]} to={[x, -1.2]} />
      ))}
      {to220 ? (
        <>
          <rect x={-0.6} y={-6.9} width={3.2} height={2.4} rx={0.15} fill="#9ca3af" />
          <circle cx={1} cy={-5.9} r={0.55} fill="#e5e7eb" />
          <rect x={-0.6} y={-4.6} width={3.2} height={3.4} rx={0.15} fill="#111827" />
        </>
      ) : (
        <rect x={-0.7} y={-4.3} width={3.4} height={3.2} rx={0.2} fill={PCB_BLUE} />
      )}
      {heat > 0 && (
        <rect
          x={-0.6}
          y={to220 ? -4.6 : -4.3}
          width={3.2}
          height={3.2}
          rx={0.15}
          fill="#ef4444"
          opacity={heat * 0.6}
        />
      )}
      <Label x={1} y={to220 ? -3 : -2.7} size={0.5}>
        {shutdown ? '🌡' : to220 ? SILK.lm7805 : SILK.ams1117}
      </Label>
    </>
  );
}

/** Silkscreen part numbers of discrete transistors. */
const TRANSISTOR_SILK: Readonly<Record<string, string>> = {
  'semiconductor.2n2222': '2N2222',
  'sensor.ds18b20': '18B20',
  'semiconductor.bc547': 'BC547',
  'semiconductor.2n3906': '2N3906',
  'semiconductor.tip120': 'TIP120',
  'semiconductor.irlz44n': 'IRLZ44N',
};

/** Red tint for a hot junction: none below 40 °C, full at 140 °C. */
const heatOf = (live: unknown): number =>
  Math.min(1, Math.max(0, ((liveNumber(live, 'junctionC') ?? 25) - 40) / 100));

/**
 * Discrete transistor: a TO-92 half-cylinder or a TO-220 with its tab. While running, a green dot
 * shows it conducting, the body tints red as the junction heats, and a burnt one shows a crack.
 */
function Transistor({ type, live }: ArtProps) {
  const to220 = type === 'semiconductor.tip120' || type === 'semiconductor.irlz44n';
  const heat = heatOf(live);
  const region = (live as { region?: string } | undefined)?.region;
  const conducting = region !== undefined && region !== 'cutoff';
  const damaged = liveFlag(live, 'damaged');
  const top = to220 ? -4.6 : -2.4;
  const height = to220 ? 3.4 : 1.9;
  return (
    <>
      {[0, 1, 2].map((x) => (
        <Leg key={x} from={[x, 0]} to={[x, top + height]} />
      ))}
      {to220 && (
        <>
          <rect x={-0.6} y={-6.9} width={3.2} height={2.4} rx={0.15} fill="#9ca3af" />
          <circle cx={1} cy={-5.9} r={0.55} fill="#e5e7eb" />
        </>
      )}
      {to220 ? (
        <rect x={-0.6} y={top} width={3.2} height={height} rx={0.15} fill="#111827" />
      ) : (
        <path
          d={`M -0.5 ${top + height} V ${top + 0.7} A 1.5 0.9 0 0 1 2.5 ${top + 0.7} V ${top + height} Z`}
          fill="#111827"
        />
      )}
      {heat > 0 && (
        <rect x={-0.6} y={top} width={3.2} height={height} rx={0.15} fill="#ef4444" opacity={heat * 0.6} />
      )}
      <Label x={1} y={top + height / 2 + (to220 ? 0 : 0.15)} size={to220 ? 0.45 : 0.38}>
        {TRANSISTOR_SILK[type] ?? ''}
      </Label>
      {conducting && !damaged && <circle cx={2.3} cy={top - 0.3} r={0.25} fill="#22c55e" />}
      {damaged && (
        <path
          d={`M 0.2 ${top} L 1 ${top + height / 2} L 0.6 ${top + height / 2} L 1.6 ${top + height}`}
          stroke="#f97316"
          strokeWidth={0.15}
          fill="none"
        />
      )}
    </>
  );
}

/** IRF520 module: header SIG/VCC/GND on the left, screw terminals on the right, the MOSFET in between. */
function Irf520Module({ live }: ArtProps) {
  const heat = heatOf(live);
  const led = liveFlag(live, 'ledOn');
  return (
    <>
      <rect x={-0.6} y={-0.8} width={12.2} height={6.6} rx={0.3} fill={PCB_BLUE} />
      {IRF520_HEADER.map((n, i) => (
        <g key={n}>
          <rect x={-0.35} y={i - 0.35} width={0.7} height={0.7} fill="#111" />
          <Label x={1.4} y={i} size={0.45}>
            {n}
          </Label>
        </g>
      ))}
      {IRF520_TERMINALS.map(([n, y]) => (
        <g key={n}>
          <rect x={10.2} y={y - 0.45} width={1.6} height={0.9} rx={0.15} fill="#16a34a" />
          <Label x={9.2} y={y} size={0.45}>
            {n}
          </Label>
        </g>
      ))}
      <rect x={4.6} y={-0.4} width={3.2} height={2} rx={0.1} fill="#9ca3af" />
      <rect x={4.6} y={1.5} width={3.2} height={2.8} rx={0.1} fill="#111827" />
      {heat > 0 && <rect x={4.6} y={1.5} width={3.2} height={2.8} fill="#ef4444" opacity={heat * 0.6} />}
      <Label x={6.2} y={2.9} size={0.45}>
        {SILK.irf520}
      </Label>
      <circle cx={3} cy={4.4} r={0.35} fill={led ? '#ef4444' : '#450a0a'} />
    </>
  );
}

/** 0.96" OLED: the panel shows the controller's frame buffer, pixel for pixel. */
function OledSsd1306(p: ArtProps) {
  const live = p.live as { on?: boolean; contrast?: number; pixels?: readonly number[] } | undefined;
  const px = OLED_W / 128;
  let d = '';
  if (live?.on && live.pixels) {
    for (let y = 0; y < 64; y++) {
      let run = -1;
      for (let x = 0; x <= 128; x++) {
        const lit = x < 128 && ((live.pixels[y * 4 + (x >> 5)] ?? 0) >>> (x & 31)) & 1;
        if (lit && run < 0) run = x;
        else if (!lit && run >= 0) {
          d += `M${OLED_X + run * px} ${OLED_Y + y * px}h${(x - run) * px}v${px}h${-(x - run) * px}z`;
          run = -1;
        }
      }
    }
  }
  return (
    <Module fp={footprintOf(p.type)} color={PCB_BLUE} label={SILK.ssd1306}>
      <rect x={OLED_X - 0.3} y={OLED_Y - 0.3} width={OLED_W + 0.6} height={OLED_W / 2 + 0.6} fill="#0b0b0f" />
      {d && <path d={d} fill="#e0f2fe" opacity={0.55 + 0.45 * ((live?.contrast ?? 207) / 255)} />}
    </Module>
  );
}
const OLED_W = 8.5;
const OLED_X = 1.5 - OLED_W / 2;
const OLED_Y = -8.6;

/** 16×2 LCD: 5×8 dot cells on the blue backlight; custom characters come from CGRAM. */
function Lcd1602(p: ArtProps) {
  const live = p.live as
    | {
        powered?: boolean;
        backlight?: boolean;
        displayOn?: boolean;
        rows?: readonly (readonly number[])[];
        cgram?: readonly number[];
        cursor?: { row: number; col: number } | null;
        cursorOn?: boolean;
        blinkVisible?: boolean;
      }
    | undefined;
  const lit = live?.powered && live.backlight;
  let dots = '';
  let cells = '';
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 16; col++) {
      const x0 = LCD_X + col * LCD_PITCH_X;
      const y0 = LCD_Y + row * LCD_PITCH_Y;
      cells += `M${x0} ${y0}h${5 * LCD_DOT_W}v${8 * LCD_DOT_H}h${-5 * LCD_DOT_W}z`;
      const code = live?.displayOn ? (live.rows?.[row]?.[col] ?? -1) : -1;
      const glyph =
        code < 0
          ? []
          : code < 8
            ? [...Array(8).keys()].map((r) => live?.cgram?.[code * 8 + r] ?? 0)
            : glyphRows(code);
      const here = live?.cursor?.row === row && live.cursor.col === col && live.displayOn;
      if (here && live?.blinkVisible) glyph.splice(0, 8, 31, 31, 31, 31, 31, 31, 31, 31);
      else if (here && live?.cursorOn) glyph[7] = 31;
      glyph.forEach((bits, r) => {
        for (let c = 0; c < 5; c++)
          if ((bits >> (4 - c)) & 1)
            dots += `M${x0 + c * LCD_DOT_W} ${y0 + r * LCD_DOT_H}h${LCD_DOT_W * 0.85}v${LCD_DOT_H * 0.85}h${-LCD_DOT_W * 0.85}z`;
      });
    }
  return (
    <>
      <rect x={-1} y={-14.6} width={31.5} height={14.5} rx={0.4} fill="#166534" />
      <rect x={0.6} y={-12.8} width={28.3} height={9.6} rx={0.3} fill="#111827" />
      <rect x={1.6} y={-12} width={26.3} height={8} fill={lit ? '#3b82f6' : '#1e3a8a'} />
      <path d={cells} fill="#ffffff" opacity={lit ? 0.08 : 0.04} />
      {dots && <path d={dots} fill={lit ? '#f8fafc' : '#94a3b8'} opacity={lit ? 1 : 0.35} />}
      {(['GND', 'VCC', 'SDA', 'SCL'] as const).map((n, i) => (
        <g key={n}>
          <rect x={i - 0.4} y={-1.3} width={0.8} height={1} fill="#111" />
          <Label x={i} y={-1.9} size={0.45}>
            {n}
          </Label>
        </g>
      ))}
    </>
  );
}
const LCD_PITCH_X = 1.4;
const LCD_PITCH_Y = 2.34;
const LCD_DOT_W = 1.16 / 5;
const LCD_DOT_H = 2.19 / 8;
const LCD_X = 14.75 - (16 * LCD_PITCH_X) / 2 + 0.12;
const LCD_Y = -10.3;

/** GY-521 MPU-6050 breakout: the QFN chip in the middle. */
function Mpu6050(p: ArtProps) {
  return (
    <Module fp={footprintOf(p.type)} color={PCB_BLUE} label={SILK.gy521}>
      <rect x={2.6} y={-4.2} width={1.6} height={1.6} rx={0.1} fill="#111827" />
    </Module>
  );
}

/** GY-BMP280 breakout: the metal-lid sensor with its vent hole. */
function Bmp280(p: ArtProps) {
  return (
    <Module fp={footprintOf(p.type)} color={PCB_RED} label={SILK.bmp280}>
      <rect x={1.9} y={-2.9} width={1.2} height={1.2} rx={0.1} fill="#d1d5db" />
      <circle cx={2.2} cy={-2.6} r={0.12} fill="#374151" />
    </Module>
  );
}

/** VL53L0X breakout: the sensor's black window with emitter and receiver apertures. */
function Vl53l0x(p: ArtProps) {
  const ranging = (p.live as { mode?: string } | undefined)?.mode === 'continuous';
  return (
    <Module fp={footprintOf(p.type)} color={PCB_BLUE} label={SILK.vl53l0x}>
      <rect x={1.6} y={-3.1} width={2.4} height={1.2} rx={0.2} fill="#111827" />
      <circle cx={2.2} cy={-2.5} r={0.3} fill={ranging ? '#7f1d1d' : '#1f2937'} />
      <circle cx={3.4} cy={-2.5} r={0.3} fill="#1f2937" />
    </Module>
  );
}

/** DHT11 module: the blue perforated housing on a small board. */
function Dht11(p: ArtProps) {
  return (
    <Module fp={footprintOf(p.type)} color={PCB_BLUE} label={SILK.dht11}>
      <rect x={-0.4} y={-9.2} width={2.8} height={5.6} rx={0.2} fill="#38bdf8" />
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2].map((c) => (
          <rect
            key={`${r}${c}`}
            x={0.05 + c * 0.75}
            y={-8.6 + r * 1.2}
            width={0.45}
            height={0.7}
            fill="#0c4a6e"
          />
        )),
      )}
    </Module>
  );
}

/** WS2812B strip: the LEDs shine in their latched colours. */
function Ws2812Strip({ props, live }: ArtProps) {
  const count = Math.max(1, Math.min(60, Math.round(Number(props['count'] ?? 8))));
  const colors = (live as { colors?: readonly number[] } | undefined)?.colors ?? [];
  const pitch = 20 / count;
  const size = Math.min(1.6, pitch * 0.8);
  return (
    <>
      <rect
        x={0.6}
        y={-0.7}
        width={21.8}
        height={3.4}
        rx={0.3}
        fill="#f8fafc"
        stroke="#cbd5e1"
        strokeWidth={0.06}
      />
      {[...Array(count).keys()].map((i) => {
        const c = colors[i] ?? 0;
        const cx = 1.6 + (i + 0.5) * pitch;
        const rgb = `rgb(${(c >> 16) & 0xff}, ${(c >> 8) & 0xff}, ${c & 0xff})`;
        const level = Math.max((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff) / 255;
        return (
          <g key={i}>
            {level > 0 && (
              <circle cx={cx} cy={1} r={size * (0.7 + level)} fill={rgb} opacity={0.35 * level + 0.15} />
            )}
            <rect
              x={cx - size / 2}
              y={1 - size / 2}
              width={size}
              height={size}
              fill={level > 0 ? rgb : '#e5e7eb'}
            />
          </g>
        );
      })}
    </>
  );
}

/** Diffused RGB LED: the three dies mix into one glow. */
function RgbLed({ live }: ArtProps) {
  const b = (live as { brightness?: readonly number[] } | undefined)?.brightness ?? [0, 0, 0];
  const [r = 0, g = 0, bl = 0] = b;
  const level = Math.max(r, g, bl);
  const mix = `rgb(${Math.round(255 * r)}, ${Math.round(255 * g)}, ${Math.round(255 * bl)})`;
  return (
    <>
      {[0, 1, 2, 3].map((x) => (
        <Leg key={x} from={[x, 0]} to={[x, x === 1 ? -1.3 : -1.1]} />
      ))}
      {level > 0 && (
        <circle cx={1.5} cy={-2.4} r={1.4 + level * 1.4} fill={mix} opacity={0.25 + level * 0.4} />
      )}
      <path
        d="M 0.2 -1.25 L 0.2 -2.6 A 1.3 1.3 0 0 1 2.8 -2.6 L 2.8 -1.25 Z"
        fill={level > 0 ? mix : '#f1f5f9'}
        opacity={0.75 + level * 0.25}
        stroke="#00000044"
        strokeWidth={0.06}
      />
      <Label x={1.5} y={-2.2} size={0.45} fill="#334155">
        {level > 0 ? '' : SILK.rgb}
      </Label>
    </>
  );
}

/** Passive buzzer: open-top transducer; sound rings and the tone while it is driven. */
function PassiveBuzzer({ live }: ArtProps) {
  const hz = liveNumber(live, 'toneHz') ?? 0;
  return (
    <>
      {hz > 0 &&
        [2.6, 3.2].map((r) => (
          <circle
            key={r}
            cx={1.5}
            cy={-2}
            r={r}
            fill="none"
            stroke="#22c55e"
            strokeWidth={0.12}
            opacity={0.8}
          />
        ))}
      <circle cx={1.5} cy={-2} r={2.05} fill="#111827" />
      <circle cx={1.5} cy={-2} r={1.2} fill="none" stroke="#4b5563" strokeWidth={0.15} />
      {hz > 0 && (
        <Label x={1.5} y={-4.9} size={0.6} fill="#111">
          {`${Math.round(hz)} Hz`}
        </Label>
      )}
    </>
  );
}

/** Segment strokes of a digit centred in the package (grid units). */
const SEGMENT_LINES: readonly (readonly [number, number, number, number])[] = [
  [1.25, 0.9, 2.95, 0.9], // a
  [3.15, 1.1, 3.0, 2.8], // b
  [2.95, 3.2, 2.8, 4.9], // c
  [1.0, 5.1, 2.7, 5.1], // d
  [0.85, 3.2, 0.7, 4.9], // e
  [1.05, 1.1, 0.9, 2.8], // f
  [1.1, 3.0, 2.85, 3.0], // g
];
const SEGMENT_FILL: Readonly<Record<string, string>> = { red: '#ef4444', green: '#22c55e', blue: '#3b82f6' };

function SevenSegment({ props, live }: ArtProps) {
  const lit = (live as { brightness?: readonly number[] } | undefined)?.brightness ?? [];
  const on = SEGMENT_FILL[String(props['color'] ?? 'red')] ?? '#ef4444';
  const shade = (i: number) => {
    const v = lit[i] ?? 0;
    return { stroke: v > 0.02 ? on : '#3f3f46', opacity: v > 0.02 ? 0.45 + 0.55 * Math.min(1, v) : 1 };
  };
  return (
    <>
      <rect x={-0.7} y={-0.5} width={5.4} height={7} rx={0.2} fill="#18181b" />
      {SEGMENT_LINES.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          strokeWidth={0.42}
          strokeLinecap="round"
          {...shade(i)}
        />
      ))}
      <circle cx={3.55} cy={5.15} r={0.25} fill={shade(7).stroke} opacity={shade(7).opacity} />
    </>
  );
}

/** Relay module: blue cube, header, screw terminal; the LED and contact arm follow the coil. */
function RelayModule({ live }: ArtProps) {
  const energized = liveFlag(live, 'energized');
  const commanded = liveFlag(live, 'commanded');
  return (
    <>
      <rect x={0} y={0} width={20} height={10} rx={0.4} fill={PCB_BLUE} />
      <rect x={6} y={1} width={8.5} height={8} rx={0.3} fill="#2563eb" stroke="#1e3a8a" strokeWidth={0.1} />
      <Label x={10.25} y={5} size={0.6}>
        {SILK.relay}
      </Label>
      <rect x={16} y={0.8} width={3.4} height={8.4} rx={0.2} fill="#16a34a" />
      <circle cx={3.5} cy={1.5} r={0.5} fill={commanded ? '#ef4444' : '#450a0a'} />
      <line
        x1={17.2}
        y1={5}
        x2={18.6}
        y2={energized ? 2.2 : 7.8}
        stroke="#fde68a"
        strokeWidth={0.3}
        strokeLinecap="round"
      />
      {(
        [
          ['IN', 3],
          ['VCC', 5],
          ['GND', 7],
        ] as const
      ).map(([n, y]) => (
        <Label key={n} x={1.6} y={y} size={0.5}>
          {n}
        </Label>
      ))}
      {(
        [
          ['NO', 2],
          ['COM', 5],
          ['NC', 8],
        ] as const
      ).map(([n, y]) => (
        <Label key={n} x={15.1} y={y} size={0.5}>
          {n}
        </Label>
      ))}
    </>
  );
}

/** LM2596 module: inductor, trimmer, power LED and the output voltage while running. */
function Lm2596({ live }: ArtProps) {
  const vout = liveNumber(live, 'vout');
  const on = vout !== null && vout > 0.5;
  return (
    <>
      <rect x={0} y={0} width={17} height={8.4} rx={0.4} fill={PCB_BLUE} />
      <circle cx={6} cy={4.2} r={2.4} fill="#374151" stroke="#111" strokeWidth={0.1} />
      <rect x={9.5} y={1.6} width={3} height={2.2} rx={0.2} fill="#111827" />
      <rect x={13.4} y={5} width={1.6} height={1.6} fill="#2563eb" />
      <circle cx={14.2} cy={5.8} r={0.45} fill="#facc15" />
      <circle cx={11.4} cy={6.4} r={0.4} fill={on ? '#ef4444' : '#450a0a'} />
      <Label x={11} y={2.7} size={0.45}>
        {SILK.lm2596}
      </Label>
      {BUCK_TERMINALS.map(([n, x, y]) => (
        <Label key={n} x={x === 0 ? 1.6 : 15.2} y={y} size={0.45}>
          {n}
        </Label>
      ))}
      {on && (
        <Label x={8.5} y={-0.8} size={0.7} fill="#111">
          {`${vout.toFixed(2)} V`}
        </Label>
      )}
    </>
  );
}

/** Output pins lit while running: gate outputs, 595 latch outputs, the CD4017's active output. */
function litPins(type: string, live: unknown): string[] {
  const s = live as { outputs?: readonly (number | null)[]; count?: number } | null | undefined;
  if (!s) return [];
  if (type === 'ic.74hc595')
    return (s.outputs ?? []).flatMap((l, i) => (l === 1 ? [`q${'abcdefgh'[i] ?? ''}`] : []));
  if (type === 'ic.cd4017') return typeof s.count === 'number' ? [`q${s.count}`] : [];
  if (type === 'ic.ne555') return (live as { output?: number | null }).output === 1 ? ['out'] : [];
  return (s.outputs ?? []).flatMap((l, i) => (l === 1 ? [`${i + 1}y`] : []));
}

/** DIP chip: body between the rows, pin-1 notch on the left, part number and lit outputs. */
function DipChip({ type, live }: ArtProps) {
  const fp = footprintOf(type);
  const pins = Object.entries(fp.pins);
  const half = pins.length / 2;
  const lit = new Set(litPins(type, live));
  const silk = type.slice(type.indexOf('.') + 1).toUpperCase();
  return (
    <>
      {pins.map(([name, [x, y]]) => (
        <rect key={name} x={x - 0.18} y={y === 0 ? 0 : y - 0.55} width={0.36} height={0.55} fill={LEG} />
      ))}
      <rect x={-0.5} y={0.5} width={half - 1 + 1} height={2} rx={0.15} fill="#1f2937" />
      <path d="M -0.5 1.15 A 0.35 0.35 0 0 1 -0.5 1.85" fill="#4b5563" />
      <Label x={(half - 1) / 2} y={1.5} size={0.55}>
        {silk}
      </Label>
      {pins
        .filter(([name]) => lit.has(name))
        .map(([name, [x, y]]) => (
          <circle key={name} cx={x} cy={y === 0 ? 0.8 : 2.2} r={0.2} fill="#22c55e" />
        ))}
    </>
  );
}

/** TB6612FNG breakout: small purple board with the chip in the middle and its mode while running. */
function Tb6612({ live }: ArtProps) {
  const s = live as { modeA?: string; modeB?: string } | undefined;
  const active = (m?: string) => m === 'forward' || m === 'reverse';
  return (
    <>
      <rect x={-0.6} y={-0.6} width={7.2} height={7.2} rx={0.3} fill="#6d28d9" />
      <rect x={2} y={2.2} width={2} height={1.6} rx={0.1} fill="#111827" />
      <Label x={3} y={1.2} size={0.5}>
        {SILK.tb6612}
      </Label>
      <circle cx={0.6} cy={3} r={0.3} fill={active(s?.modeA) ? '#22c55e' : '#1f2937'} />
      <circle cx={5.4} cy={3} r={0.3} fill={active(s?.modeB) ? '#22c55e' : '#1f2937'} />
    </>
  );
}

/** L9110S module: header on the left, two driver chips, motor terminals on the right. */
function L9110s(p: ArtProps) {
  const fp = footprintOf(p.type);
  return (
    <>
      <rect x={0} y={0} width={11} height={8} rx={0.4} fill={PCB_RED} />
      <rect x={4} y={1} width={2.2} height={1.6} fill="#111827" />
      <rect x={4} y={5.2} width={2.2} height={1.6} fill="#111827" />
      <rect x={8.6} y={0.4} width={2} height={2.4} rx={0.2} fill="#2563eb" />
      <rect x={8.6} y={5.2} width={2} height={2.4} rx={0.2} fill="#2563eb" />
      <Label x={5.1} y={4} size={0.55}>
        {SILK.l9110s}
      </Label>
      {Object.entries(fp.pins)
        .filter(([, [x]]) => x === 0)
        .map(([name, [, y]]) => (
          <Label key={name} x={1.9} y={y} size={0.42}>
            {name.toUpperCase()}
          </Label>
        ))}
    </>
  );
}

/** 28BYJ-48: round can with two mounting ears; the shaft mark turns with the output angle. */
function Stepper({ live }: ArtProps) {
  const deg = liveNumber(live, 'shaftDeg') ?? 0;
  const a = (deg * Math.PI) / 180;
  const [cx, cy] = [2, -7];
  return (
    <>
      {Object.entries(STEPPER_WIRES).map(([name, color], i) => (
        <path key={name} d={`M ${i} 0 V -2.4`} stroke={color} strokeWidth={0.22} />
      ))}
      <rect x={-3.4} y={-8} width={10.8} height={2} rx={1} fill="#cbd5e1" />
      <circle cx={cx} cy={cy} r={5.4} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.12} />
      <rect x={-0.5} y={-2.6} width={5} height={1.2} rx={0.2} fill="#2563eb" />
      <circle cx={cx} cy={cy - 2} r={1.2} fill="#facc15" />
      <line
        x1={cx}
        y1={cy - 2}
        x2={cx + 2 * Math.sin(a)}
        y2={cy - 2 - 2 * Math.cos(a)}
        stroke="#111827"
        strokeWidth={0.45}
        strokeLinecap="round"
      />
      <Label x={cx} y={cy + 2.2} size={0.6} fill="#334155">
        {SILK.stepper}
      </Label>
    </>
  );
}

/** Lever microswitch: black body, steel lever that drops when pressed. */
function BumpSwitch({ live }: ArtProps) {
  const pressed = liveFlag(live, 'pressed');
  return (
    <>
      {[0, 2, 4].map((x) => (
        <Leg key={x} from={[x, 0]} to={[x, -0.8]} />
      ))}
      <rect x={-0.6} y={-2.8} width={5.2} height={2} rx={0.2} fill="#111827" />
      <circle cx={0.9} cy={-2.3} r={0.25} fill="#dc2626" />
      <line
        x1={-0.2}
        y1={-3}
        x2={4.8}
        y2={pressed ? -3 : -4.1}
        stroke="#cbd5e1"
        strokeWidth={0.25}
        strokeLinecap="round"
      />
      <circle cx={4.8} cy={pressed ? -3 : -4.1} r={0.35} fill="#94a3b8" />
    </>
  );
}

function Line5ch(p: ArtProps) {
  const out = (p.live as { outputs?: Record<string, number> } | undefined)?.outputs ?? {};
  return (
    <Module fp={footprintOf(p.type)} color={PCB_BLUE} label={SILK.line5}>
      {[-2, 0.5, 3, 5.5, 8].map((cx, i) => (
        <g key={cx}>
          <rect x={cx - 0.9} y={-8.2} width={1.8} height={1.6} rx={0.3} fill="#111" />
          <circle cx={cx} cy={-5.8} r={0.3} fill={out[`s${i + 1}`] === 1 ? '#ef4444' : '#450a0a'} />
        </g>
      ))}
    </Module>
  );
}

function IrObstacle(p: ArtProps) {
  const obstacle = liveFlag(p.live, 'obstacle');
  return (
    <Module fp={footprintOf(p.type)} color={PCB_BLUE} label={SILK.fc51}>
      <circle cx={0.4} cy={-10.6} r={0.7} fill="#e2e8f0" />
      <circle cx={1.8} cy={-10.6} r={0.7} fill="#1f2937" />
      <rect x={0.2} y={-7.5} width={1.8} height={1.6} rx={0.2} fill="#2563eb" />
      <circle cx={2.6} cy={-5} r={0.3} fill={obstacle ? '#22c55e' : '#14532d'} />
    </Module>
  );
}

function Pir(p: ArtProps) {
  const on = liveFlag(p.live, 'out');
  return (
    <Module fp={footprintOf(p.type)} color="#15803d" label={SILK.pir}>
      <circle
        cx={1}
        cy={-6.6}
        r={3.6}
        fill={on ? '#fef9c3' : '#f8fafc'}
        stroke="#cbd5e1"
        strokeWidth={0.12}
      />
      {[-1.6, 0, 1.6].map((d) => (
        <path key={d} d={`M ${1 + d - 1} -6.6 h 2`} stroke="#e2e8f0" strokeWidth={0.1} />
      ))}
    </Module>
  );
}

function SoundSensor(p: ArtProps) {
  const fired = (p.live as { do?: number } | undefined)?.do === 1;
  return (
    <Module fp={footprintOf(p.type)} color={PCB_RED} label={SILK.ky038}>
      <circle cx={1.5} cy={-11.2} r={1.9} fill="#1f2937" stroke="#9ca3af" strokeWidth={0.12} />
      <rect x={0.6} y={-7.4} width={1.8} height={1.6} fill="#2563eb" />
      <circle cx={3.6} cy={-5} r={0.3} fill={fired ? '#22c55e' : '#14532d'} />
    </Module>
  );
}

function SoilMoisture(p: ArtProps) {
  const wet = liveFlag(p.live, 'wet');
  return (
    <Module fp={footprintOf(p.type)} color={PCB_RED} label={SILK.soil}>
      <path d="M 0.2 -13.8 v 5 M 2.8 -13.8 v 5" stroke="#d4a017" strokeWidth={0.6} strokeLinecap="round" />
      <rect x={-0.2} y={-9} width={3.4} height={1} fill="#b45309" />
      <circle cx={3.6} cy={-5} r={0.3} fill={wet ? '#22c55e' : '#14532d'} />
    </Module>
  );
}

function Joystick(p: ArtProps) {
  const x = liveNumber(p.live, 'x') ?? 0;
  const y = liveNumber(p.live, 'y') ?? 0;
  const pressed = liveFlag(p.live, 'pressed');
  return (
    <Module fp={footprintOf(p.type)} color={PCB_RED} label={SILK.ky023}>
      <circle cx={2} cy={-8} r={3.4} fill="#374151" />
      <circle
        data-input="pressed"
        cx={2 + 1.4 * x}
        cy={-8 - 1.4 * y}
        r={2}
        fill={pressed ? '#0f172a' : '#1f2937'}
        stroke="#6b7280"
        strokeWidth={0.15}
      />
    </Module>
  );
}

/** 4×4 membrane keypad: every key is its own button (`data-input`) while running. */
function Keypad({ live }: ArtProps) {
  const pressed = new Set((live as { pressed?: readonly string[] } | undefined)?.pressed ?? []);
  return (
    <>
      <rect x={-10} y={-30} width={27} height={29} rx={0.8} fill="#1e293b" />
      <rect x={1.5} y={-1.6} width={4} height={1.4} fill="#475569" />
      {KEYPAD_ROWS.flatMap((row, r) =>
        row.map((legend, c) => {
          const cx = -6.5 + c * 6.6;
          const cy = -26 + r * 6.6;
          const down = pressed.has(legend);
          return (
            <g key={legend} data-input={keyInputName(legend)}>
              <rect
                x={cx - 2.6}
                y={cy - 2.6}
                width={5.2}
                height={5.2}
                rx={0.6}
                fill={down ? '#38bdf8' : /[A-D]/.test(legend) ? '#dc2626' : '#e2e8f0'}
              />
              <Label x={cx} y={cy} size={1.8} fill={down ? '#0f172a' : '#111827'}>
                {legend}
              </Label>
            </g>
          );
        }),
      )}
    </>
  );
}

/** KY-040: knob with a pointer that follows the detents (20 per turn); press the knob for SW. */
function RotaryEncoder(p: ArtProps) {
  const a = ((liveNumber(p.live, 'detents') ?? 0) * 18 * Math.PI) / 180;
  const pressed = liveFlag(p.live, 'pressed');
  return (
    <Module fp={footprintOf(p.type)} color={PCB_BLUE} label={SILK.ky040}>
      <circle cx={2} cy={-7.6} r={2.9} fill="#9ca3af" />
      <circle data-input="pressed" cx={2} cy={-7.6} r={2.2} fill={pressed ? '#475569' : '#334155'} />
      <line
        x1={2}
        y1={-7.6}
        x2={2 + 1.9 * Math.sin(a)}
        y2={-7.6 - 1.9 * Math.cos(a)}
        stroke="#f8fafc"
        strokeWidth={0.3}
        strokeLinecap="round"
        pointerEvents="none"
      />
    </Module>
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
  'semiconductor.diode-1n4007': Diode,
  'semiconductor.diode-1n4148': Diode,
  'semiconductor.zener-5v1': Diode,
  'semiconductor.lm7805': Regulator,
  'semiconductor.ams1117-3v3': Regulator,
  'actuator.led-rgb': RgbLed,
  'actuator.buzzer-passive': PassiveBuzzer,
  'actuator.relay-module': RelayModule,
  'actuator.mg996r-servo': Servo,
  'display.seven-segment': SevenSegment,
  'power.lm2596': Lm2596,
  'ic.74hc00': DipChip,
  'ic.74hc08': DipChip,
  'ic.74hc32': DipChip,
  'ic.74hc86': DipChip,
  'ic.74hc14': DipChip,
  'ic.74hc595': DipChip,
  'ic.cd4017': DipChip,
  'ic.uln2003a': DipChip,
  'ic.ne555': DipChip,
  'semiconductor.2n2222': Transistor,
  'semiconductor.bc547': Transistor,
  'semiconductor.2n3906': Transistor,
  'semiconductor.tip120': Transistor,
  'semiconductor.irlz44n': Transistor,
  'driver.irf520-module': Irf520Module,
  'display.oled-ssd1306': OledSsd1306,
  'display.lcd1602-i2c': Lcd1602,
  'sensor.mpu6050': Mpu6050,
  'sensor.bmp280': Bmp280,
  'sensor.vl53l0x': Vl53l0x,
  'sensor.dht11': Dht11,
  'sensor.ds18b20': Transistor,
  'actuator.ws2812-strip': Ws2812Strip,
  'passive.capacitor-ceramic': CeramicCap,
  'passive.capacitor-electrolytic': ElectrolyticCap,
  'driver.tb6612fng': Tb6612,
  'driver.l9110s': L9110s,
  'actuator.stepper-28byj48': Stepper,
  'sensor.bump-switch': BumpSwitch,
  'sensor.line-5ch': Line5ch,
  'sensor.ir-obstacle': IrObstacle,
  'sensor.pir': Pir,
  'sensor.sound': SoundSensor,
  'sensor.soil-moisture': SoilMoisture,
  'sensor.joystick': Joystick,
  'sensor.keypad-4x4': Keypad,
  'sensor.rotary-encoder': RotaryEncoder,
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
