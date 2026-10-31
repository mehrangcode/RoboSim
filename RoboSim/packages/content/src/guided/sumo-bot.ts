import type { GuidedCheckInput } from '@robosim/shared';
import { sumoArena, sumoChallenge } from '../arenas/open-arenas.js';
import { BASE_SVG, PWM_SVG } from './assets.js';
import { DRIVE_CODE_CHECKS, DRIVE_STEPS, introStep } from './drive-steps.js';
import { DRIVE_PARTS, DRIVE_WIRES, finished, g, part, robotBase, slot } from './robot.js';
import {
  SUMO_BOT_PINS,
  SUMO_BOT_RANGE,
  SUMO_BOT_SOLUTION_SKETCH,
  SUMO_BOT_STARTER_SKETCH,
} from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'sumo-bot';
const VERSION = 1;
const LINE = 'sensor.line-3ch';
const SONAR = 'sensor.hc-sr04';
const line = (pin: string) => ({ type: LINE, pin });
const sonar = (pin: string) => ({ type: SONAR, pin });
const EYES = ['left', 'center', 'right'] as const;

/* Images: light card, no text (one image serves both languages), front of the robot to the right. */
const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<rect width="${w}" height="${h}" rx="12" fill="#f5f2ea"/>${body}</svg>`;

const SONAR_BLUE = '#1565c0';
const SENSOR_GREEN = '#2e7d32';
const OPPONENT = '#c0392b';

/** A small top-view robot centred on (x, y), facing `deg` (0 = right): sonar on top, line sensor under the front. */
const robot = (x: number, y: number, deg: number, s = 1): string =>
  `<g transform="translate(${x} ${y}) rotate(${deg}) scale(${s})">` +
  `<rect x="-26" y="-20" width="52" height="40" rx="7" fill="#d9c9a3" stroke="#8a7650" stroke-width="2"/>` +
  `<rect x="-12" y="-25" width="18" height="7" rx="2" fill="#333"/>` +
  `<rect x="-12" y="18" width="18" height="7" rx="2" fill="#333"/>` +
  `<rect x="-8" y="-11" width="22" height="22" rx="2" fill="#1f6fa8"/>` +
  `<rect x="26" y="-12" width="6" height="24" rx="2" fill="${SENSOR_GREEN}"/>` +
  `<rect x="16" y="-8" width="8" height="16" rx="2" fill="${SONAR_BLUE}"/>` +
  `</g>`;

const ring = (cx: number, cy: number, r: number): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="#fff" stroke="#bbb" stroke-width="1"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${r - 4}" fill="#222"/>`;

const COVER = svg(
  320,
  180,
  ring(160, 90, 78) +
    robot(125, 95, -10, 0.75) +
    `<rect x="178" y="70" width="34" height="34" rx="3" fill="${OPPONENT}" transform="rotate(8 195 87)"/>` +
    [12, 22]
      .map(
        (r) =>
          `<path d="M${152 + r} ${88 - r} a${r} ${r} 0 0 1 0 ${2 * r}" stroke="#90caf9" stroke-width="2.5" fill="none"/>`,
      )
      .join(''),
);

/** The line sensor's eyes reaching the white edge of the black ring. */
const EDGE_SVG = svg(
  280,
  150,
  `<rect x="0" y="0" width="280" height="150" rx="12" fill="#9e9e9e"/>` +
    `<path d="M0 0 H190 Q170 75 190 150 H0 Z" fill="#222"/>` +
    `<path d="M190 0 Q170 75 190 150" stroke="#fff" stroke-width="14" fill="none"/>` +
    robot(140, 75, 0, 1.3) +
    [-12, 0, 12]
      .map(
        (dy, i) =>
          `<circle cx="${140 + 38}" cy="${75 + dy * 1.3}" r="4" fill="${i === 0 ? '#ffcdd2' : '#ff5252'}"/>`,
      )
      .join(''),
);

/** The three jobs in priority order: edge, attack, search. */
const PRIORITY_SVG = svg(
  300,
  160,
  [
    {
      y: 18,
      fill: '#fff',
      stroke: '#888',
      icon: `<rect x="34" y="28" width="20" height="20" fill="none" stroke="#222" stroke-width="5"/>`,
    },
    {
      y: 64,
      fill: '#ffebee',
      stroke: OPPONENT,
      icon: `<rect x="34" y="74" width="20" height="20" rx="2" fill="${OPPONENT}"/>`,
    },
    {
      y: 110,
      fill: '#e3f2fd',
      stroke: SONAR_BLUE,
      icon: `<path d="M44 114 a12 12 0 1 1 -11 8" stroke="${SONAR_BLUE}" stroke-width="4" fill="none"/>`,
    },
  ]
    .map(
      (b, i) =>
        `<rect x="20" y="${b.y}" width="${260 - i * 50}" height="38" rx="8" fill="${b.fill}" stroke="${b.stroke}" stroke-width="2"/>${b.icon}`,
    )
    .join(''),
);

const starter = robotBase(
  { slug: SLUG, version: VERSION },
  'Sumo Bot',
  SUMO_BOT_STARTER_SKETCH,
  sumoArena,
  sumoChallenge,
);

export const sumoBot: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: false,
  minutes: 55,
  arenaId: sumoArena.id,
  cover: COVER,
  title: { en: 'Sumo Bot', fa: 'ربات سومو' },
  summary: {
    en: 'Build a robot wrestler: a line sensor keeps it inside the ring, a sonar finds the opponent, and clear priorities decide what it does first.',
    fa: 'یک ربات کشتی‌گیر بساز: سنسور خط آن را داخل رینگ نگه می‌دارد، سونار حریف را پیدا می‌کند و اولویت‌های روشن تعیین می‌کنند اول چه کاری بکند.',
  },
  steps: [
    introStep(
      'In this project you build a sumo robot. It must push the red block out of the black ring within a minute, without ever leaving the ring itself.',
      'در این پروژه یک ربات سومو می‌سازی. باید ظرف یک دقیقه جعبهٔ قرمز را از رینگ سیاه بیرون بیندازد، بدون این‌که خودش حتی یک بار از رینگ بیرون برود.',
    ),
    ...DRIVE_STEPS,
    {
      id: 'edge-sensor',
      title: { en: 'Eyes on the edge', fa: 'چشم روی لبه' },
      body: {
        en: `The ring is black with a **white edge**, and the floor outside is grey. The **3-channel line sensor** looks down: each output is **HIGH** over black and **LOW** over anything light. So *any* LOW means "the edge is right under my nose".

![The line sensor reaching the white edge](asset:edge)

Add a **3-channel line sensor** and put it on the robot, under the **FRONT** (the front bracket), so it sees the edge before the wheels get there. Connect **VCC → 5V**, **GND → GND** and **L, C, R** to three digital pins, for example **D2, D3, D4**.`,
        fa: `رینگ سیاه است با یک **لبهٔ سفید** و زمین بیرونش خاکستری است. **سنسور خط سه‌کاناله** به پایین نگاه می‌کند: هر خروجی روی سیاه **HIGH** و روی هر چیز روشنی **LOW** است. پس *هر* LOW یعنی «لبه درست زیر دماغ من است».

![سنسور خط به لبهٔ سفید رسیده](asset:edge)

یک **سنسور خط سه‌کاناله** اضافه کن و آن را زیر **جلوی** ربات (براکت جلو) بگذار تا لبه را قبل از چرخ‌ها ببیند. **VCC ← 5V**، **GND ← GND** و **L، C، R** را به سه پایهٔ دیجیتال وصل کن، مثلاً **D2، D3، D4**.`,
      },
      checks: [
        { kind: 'part', type: LINE, onRobot: true },
        { kind: 'boardPin', pin: line('vcc'), pinKind: '5v' },
        { kind: 'boardPin', pin: line('gnd'), pinKind: 'ground' },
        ...EYES.map((pin): GuidedCheckInput => ({ kind: 'boardPin', pin: line(pin), pinKind: 'digital' })),
      ],
    },
    {
      id: 'sonar',
      title: { en: 'A sonar to find the opponent', fa: 'سونار برای پیدا کردن حریف' },
      body: {
        en: `The **HC-SR04** finds the opponent: **TRIG** sends an ultrasonic click and **ECHO** stays HIGH until it comes back, longer for farther things.

Add an **HC-SR04** and put it on the robot on the front top slot, facing **FRONT** (the robot charges where the sonar looks). Connect **VCC → 5V**, **GND → GND**, **TRIG → D12** and **ECHO → D11** (or two other free digital pins).`,
        fa: `**HC-SR04** حریف را پیدا می‌کند: **TRIG** یک صدای فراصوت می‌فرستد و **ECHO** تا برگشتن آن HIGH می‌ماند؛ هرچه چیزی دورتر باشد، پالس طولانی‌تر است.

یک **HC-SR04** اضافه کن و روی جای بالای جلوی ربات، رو به **جلو** بگذار (ربات به همان سمتی حمله می‌کند که سونار نگاه می‌کند). **VCC ← 5V**، **GND ← GND**، **TRIG ← D12** و **ECHO ← D11** را وصل کن (یا دو پایهٔ دیجیتال آزاد دیگر).`,
      },
      checks: [
        { kind: 'part', type: SONAR, onRobot: true },
        { kind: 'boardPin', pin: sonar('vcc'), pinKind: '5v' },
        { kind: 'boardPin', pin: sonar('gnd'), pinKind: 'ground' },
        { kind: 'boardPin', pin: sonar('trig'), pinKind: 'digital' },
        { kind: 'boardPin', pin: sonar('echo'), pinKind: 'digital' },
      ],
    },
    {
      id: 'code',
      title: { en: 'Priorities in code', fa: 'اولویت‌ها در کد' },
      body: {
        en: `Open the **Code** tab and replace each pin number **0** with the pin you wired, for example \`const int LEFT = 2;\`.

A sumo robot has three jobs, and they can clash: the opponent may be straight ahead *and* the edge right under the sensor. So \`loop()\` asks in a fixed order and acts on the **first** yes:

![Edge first, then attack, then search](asset:priority)

1. **EDGE**: any line sensor LOW? Reverse, turn away from the side that saw white and head back to the middle. This comes first: a robot that leaves the ring loses, however hard it pushes.
2. **ATTACK**: does the sonar see something close? Charge at full power. Pressed against the block, the echo is too short to measure, so it keeps charging for 0.4 s after the last sighting.
3. **SEARCH**: nothing seen, so spin slowly on the spot and look around.

Each branch ends with \`return\`, so a lower job never overrides a higher one.`,
        fa: `زبانهٔ **کد** را باز کن و هر شمارهٔ پایهٔ **0** را با پایه‌ای که سیم‌کشی کرده‌ای عوض کن، مثلاً \`const int LEFT = 2;\`.

ربات سومو سه کار دارد که ممکن است با هم تداخل کنند: شاید حریف درست جلویش باشد *و* لبه هم درست زیر سنسور. برای همین \`loop()\` به ترتیبی ثابت سؤال می‌کند و به **اولین** جواب «بله» عمل می‌کند:

![اول لبه، بعد حمله، بعد جست‌وجو](asset:priority)

۱. **EDGE** (لبه): یکی از سنسورهای خط LOW است؟ عقب برو، از سمتی که سفید دیده دور بچرخ و به وسط برگرد. این اول است: رباتی که از رینگ بیرون برود می‌بازد، هر قدر هم محکم هل بدهد.
۲. **ATTACK** (حمله): سونار چیزی نزدیک می‌بیند؟ با تمام قدرت حمله کن. وقتی به جعبه چسبیده، پژواک کوتاه‌تر از آن است که اندازه گرفته شود، پس تا ۰٫۴ ثانیه بعد از آخرین دیدن هم به هل دادن ادامه می‌دهد.
۳. **SEARCH** (جست‌وجو): چیزی دیده نمی‌شود، پس آرام دور خودش می‌چرخد و اطراف را نگاه می‌کند.

هر شاخه با \`return\` تمام می‌شود، پس یک کار پایین‌تر هیچ‌وقت کار بالاتر را خنثی نمی‌کند.`,
      },
      checks: [
        ...DRIVE_CODE_CHECKS,
        ...EYES.map((pin): GuidedCheckInput => ({ kind: 'code', use: 'digitalRead', at: line(pin) })),
        { kind: 'code', use: 'digitalWrite', at: sonar('trig') },
        { kind: 'code', use: 'pinMode', at: sonar('echo') },
      ],
      solution: SUMO_BOT_PINS,
    },
    {
      id: 'run',
      title: { en: 'Choose your range and fight', fa: 'برد دید را انتخاب کن و مبارزه کن' },
      body: {
        en: `One blank is left: \`SEE_CM\`, how near something must be to count as the opponent. At **0** the robot sees nothing and only spins.

Think about the arena: the ring is about **150 cm** across, so from the middle the opponent is never more than about **80 cm** away, but the arena walls are farther than **1 m**. Pick a value that sees the whole ring but not the walls, around **80–90 cm**, press **Run** and push the block out.`,
        fa: `یک جای خالی مانده: \`SEE_CM\`، این‌که چیزی چقدر باید نزدیک باشد تا حریف حساب شود. با **0** ربات هیچ‌چیز نمی‌بیند و فقط دور خودش می‌چرخد.

به میدان فکر کن: قطر رینگ حدود **۱۵۰ سانتی‌متر** است، پس از وسط رینگ حریف هیچ‌وقت بیش از حدود **۸۰ سانتی‌متر** دور نیست، اما دیوارهای میدان بیش از **۱ متر** فاصله دارند. عددی انتخاب کن که کل رینگ را ببیند اما دیوارها را نه، حدود **۸۰ تا ۹۰ سانتی‌متر**، **اجرا** را بزن و جعبه را بیرون بینداز.`,
      },
      checks: [{ kind: 'run' }],
      solution: SUMO_BOT_RANGE,
      hints: {
        notRun: {
          en: 'Run until the block is out of the ring and your robot is still in it. If the robot spins forever, SEE_CM is too small; if it charges at nothing and keeps hitting the edge, it is too big. If it drives out of the ring, check that the line sensor is under the front and L, C, R are on the pins the sketch reads.',
          fa: 'اجرا کن تا جعبه از رینگ بیرون برود و رباتت داخل بماند. اگر ربات بی‌پایان دور خودش می‌چرخد، SEE_CM خیلی کوچک است؛ اگر به سمت هیچ‌چیز حمله می‌کند و مدام به لبه می‌رسد، خیلی بزرگ است. اگر از رینگ بیرون می‌رود، مطمئن شو سنسور خط زیر جلوی ربات است و L، C، R به همان پایه‌هایی وصل‌اند که برنامه می‌خواند.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [
      ...DRIVE_PARTS,
      part('line', LINE, g(40), g(42), { mount: slot('front-bracket') }),
      part('sonar', SONAR, g(40), g(36), { mount: slot('front-top') }),
    ],
    [
      ...DRIVE_WIRES,
      ['board.5V', 'line.vcc'],
      ['line.gnd', 'board.GND3'],
      ['line.left', 'board.D2'],
      ['line.center', 'board.D3'],
      ['line.right', 'board.D4'],
      ['board.5V', 'sonar.vcc'],
      ['sonar.gnd', 'board.GND3'],
      ['board.D12', 'sonar.trig'],
      ['sonar.echo', 'board.D11'],
    ],
    SUMO_BOT_SOLUTION_SKETCH,
  ),
  assets: { base: BASE_SVG, pwm: PWM_SVG, edge: EDGE_SVG, priority: PRIORITY_SVG },
};
