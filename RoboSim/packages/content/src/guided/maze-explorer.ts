import { mazeArena, mazeChallenge } from '../arenas/open-arenas.js';
import { BASE_SVG, PWM_SVG } from './assets.js';
import { DRIVE_CODE_CHECKS, DRIVE_STEPS, introStep } from './drive-steps.js';
import { DRIVE_PARTS, DRIVE_WIRES, finished, g, part, robotBase, slot } from './robot.js';
import {
  MAZE_EXPLORER_PINS,
  MAZE_EXPLORER_SOLUTION_SKETCH,
  MAZE_EXPLORER_STARTER_SKETCH,
  MAZE_EXPLORER_TURN,
} from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'maze-explorer';
const VERSION = 1;
const SONAR = 'sensor.hc-sr04';
const sonar = (pin: string) => ({ type: SONAR, pin });

/* Images: light card, no text (one image serves both languages), front of the robot to the right. */
const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<rect width="${w}" height="${h}" rx="12" fill="#f5f2ea"/>${body}</svg>`;

const WALL = '#6d4c41';
const SONAR_BLUE = '#1565c0';
const GOAL = '#2e7d32';

/** A small top-view robot centred on (x, y), facing `deg` (0 = right), with a front and a right sonar. */
const robot = (x: number, y: number, deg: number, s = 1): string =>
  `<g transform="translate(${x} ${y}) rotate(${deg}) scale(${s})">` +
  `<rect x="-26" y="-20" width="52" height="40" rx="7" fill="#d9c9a3" stroke="#8a7650" stroke-width="2"/>` +
  `<rect x="-12" y="-25" width="18" height="7" rx="2" fill="#333"/>` +
  `<rect x="-12" y="18" width="18" height="7" rx="2" fill="#333"/>` +
  `<rect x="-8" y="-11" width="22" height="22" rx="2" fill="#1f6fa8"/>` +
  `<rect x="22" y="-9" width="7" height="18" rx="2" fill="${SONAR_BLUE}"/>` +
  `<rect x="-2" y="17" width="16" height="7" rx="2" fill="${SONAR_BLUE}"/>` +
  `</g>`;

/** Echo arcs from (x, y) in direction `deg`. */
const ping = (x: number, y: number, deg: number, radii: readonly number[]): string =>
  `<g transform="translate(${x} ${y}) rotate(${deg})">` +
  radii
    .map(
      (r) =>
        `<path d="M${r * 0.7} ${-r * 0.7} a${r} ${r} 0 0 1 0 ${r * 1.4}" stroke="${SONAR_BLUE}" stroke-width="2.5" fill="none"/>`,
    )
    .join('') +
  `</g>`;

const wall = (x1: number, y1: number, x2: number, y2: number): string =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${WALL}" stroke-width="6" stroke-linecap="round"/>`;

/** A little maze with the right-hand path dashed through it. */
const COVER = svg(
  320,
  180,
  [
    wall(40, 20, 280, 20),
    wall(40, 160, 280, 160),
    wall(40, 20, 40, 160),
    wall(280, 20, 280, 160),
    wall(100, 20, 100, 100),
    wall(160, 80, 160, 160),
    wall(220, 20, 220, 110),
  ].join('') +
    `<path d="M70 140 V50 M70 50 H70 M70 140 H130 V45 H190 V135 H250 V45" stroke="${GOAL}" stroke-width="3" stroke-dasharray="7 5" fill="none"/>` +
    `<circle cx="250" cy="45" r="14" fill="none" stroke="${GOAL}" stroke-width="4"/>` +
    robot(70, 132, -90, 0.6),
);

/** Sonars: one looks ahead (front), one looks right; the right wall is a hand on the wall. */
const SONARS_SVG = svg(
  280,
  170,
  wall(20, 140, 260, 140) +
    wall(250, 20, 250, 140) +
    robot(110, 85, 0) +
    ping(140, 85, 0, [16, 30, 44]) +
    ping(116, 110, 90, [10, 20]),
);

/** The right-hand rule at a cell: right if open, else straight, else left. */
const RULE_SVG = svg(
  300,
  170,
  wall(90, 20, 210, 20) +
    wall(90, 20, 90, 150) +
    wall(210, 100, 210, 150) +
    robot(150, 110, -90, 0.8) +
    `<path d="M150 80 V50" stroke="#888" stroke-width="3" fill="none" marker-end="url(#a)"/>` +
    `<path d="M165 70 Q190 60 240 60" stroke="${GOAL}" stroke-width="4" fill="none" marker-end="url(#g)"/>` +
    `<defs>` +
    `<marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#888"/></marker>` +
    `<marker id="g" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="${GOAL}"/></marker>` +
    `</defs>`,
);

const starter = robotBase(
  { slug: SLUG, version: VERSION },
  'Maze Explorer',
  MAZE_EXPLORER_STARTER_SKETCH,
  mazeArena,
  mazeChallenge,
);

export const mazeExplorer: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: false,
  minutes: 60,
  arenaId: mazeArena.id,
  cover: COVER,
  title: { en: 'Maze Explorer', fa: 'کاوشگر هزارتو' },
  summary: {
    en: 'Two sonars and the right-hand rule: your robot keeps a hand on the wall, decides at every cell where to go, and finds its way out of a 5 × 5 maze.',
    fa: 'دو سونار و قانون دست راست: رباتت دستش را روی دیوار نگه می‌دارد، در هر خانه تصمیم می‌گیرد کجا برود و راهش را از یک هزارتوی ۵ × ۵ پیدا می‌کند.',
  },
  steps: [
    introStep(
      'In this project you build a robot that finds its way through a maze, from the start in the bottom-left corner to the goal in the top-right, without knowing the map.',
      'در این پروژه رباتی می‌سازی که بدون دانستن نقشه، راهش را در یک هزارتو از شروع در گوشهٔ پایین چپ تا هدف در گوشهٔ بالا راست پیدا می‌کند.',
    ),
    ...DRIVE_STEPS,
    {
      id: 'sonars',
      title: { en: 'Right hand on the wall: two sonars', fa: 'دست راست روی دیوار: دو سونار' },
      body: {
        en: `Walk into a maze, put your right hand on the wall and never let go: you reach the exit of any maze whose walls all hang together, like this one. Your robot does the same, one **45 cm cell** at a time. In the middle of each cell it asks, in this order:

1. Is the **right** side open? Turn right.
2. Otherwise, is the way **ahead** clear? Go straight on.
3. Otherwise turn **left** and ask again. Two lefts in a row is a U-turn out of a dead end.

![At a cell the robot prefers right, then straight on, then left](asset:rule)

To answer it needs two distance sensors, one looking **ahead** and one looking **right**. The **HC-SR04** measures distance with an ultrasonic click: **TRIG** starts it and **ECHO** stays HIGH until the echo comes back.

![One sonar looks ahead, the other looks right](asset:sonars)

Add **two HC-SR04s** and put both on the robot. In the **Robot** view the edges are labelled **FRONT**, **BACK**, **LEFT** and **RIGHT**:

- the **front** sonar goes on the front top slot, facing forward;
- the **right** sonar goes on the **RIGHT** edge of the plate. Turn it with its handle (or set **Turn** to **−90°**) so it looks right, not forward. On the left side it would follow the wrong wall.

Wire both: **VCC → 5V**, **GND → GND**. Front sonar **TRIG → D12**, **ECHO → D11**; right sonar **TRIG → D4**, **ECHO → D3** (any free digital pins work).`,
        fa: `وارد یک هزارتو شو، دست راستت را روی دیوار بگذار و هیچ‌وقت برش ندار: از هر هزارتویی که دیوارهایش به هم وصل‌اند، مثل همین یکی، بیرون می‌آیی. رباتت هم همین کار را می‌کند، هر بار یک **خانهٔ ۴۵ سانتی‌متری**. وسط هر خانه به این ترتیب می‌پرسد:

۱. سمت **راست** باز است؟ به راست بپیچ.
۲. وگرنه، راه **جلو** باز است؟ مستقیم برو.
۳. وگرنه به **چپ** بپیچ و دوباره بپرس. دو بار چپ پشت سر هم یعنی دور زدن و بیرون آمدن از بن‌بست.

![ربات در هر خانه اول راست، بعد جلو و بعد چپ را ترجیح می‌دهد](asset:rule)

برای جواب دادن دو سنسور فاصله لازم دارد: یکی رو به **جلو** و یکی رو به **راست**. **HC-SR04** فاصله را با یک صدای فراصوت اندازه می‌گیرد: **TRIG** آن را راه می‌اندازد و **ECHO** تا برگشتن پژواک HIGH می‌ماند.

![یک سونار رو به جلو و دیگری رو به راست](asset:sonars)

**دو HC-SR04** اضافه کن و هر دو را روی ربات بگذار. در نمای **ربات** لبه‌ها با **جلو**، **عقب**، **چپ** و **راست** مشخص شده‌اند:

- سونار **جلو** روی جای بالای جلو و رو به جلو قرار می‌گیرد؛
- سونار **راست** روی لبهٔ **راست** صفحه می‌رود. با دستگیره‌اش بچرخانش (یا **چرخش** را روی **−۹۰°** بگذار) تا به راست نگاه کند، نه به جلو. اگر سمت چپ باشد، دیوار اشتباهی را دنبال می‌کند.

هر دو را سیم‌کشی کن: **VCC ← 5V**، **GND ← GND**. سونار جلو: **TRIG ← D12** و **ECHO ← D11**؛ سونار راست: **TRIG ← D4** و **ECHO ← D3** (هر پایهٔ دیجیتال آزادی هم کار می‌کند).`,
      },
      checks: [
        { kind: 'part', type: SONAR, count: 2, onRobot: true },
        { kind: 'boardPin', pin: sonar('vcc'), pinKind: '5v' },
        { kind: 'boardPin', pin: sonar('gnd'), pinKind: 'ground' },
        { kind: 'boardPin', pin: sonar('trig'), pinKind: 'digital' },
        { kind: 'boardPin', pin: sonar('echo'), pinKind: 'digital' },
      ],
      hints: {
        notOnRobot: {
          en: 'Put both sonars on the robot: one on the front facing forward, one on the RIGHT edge turned to face right.',
          fa: 'هر دو سونار را روی ربات بگذار: یکی جلو و رو به جلو، یکی روی لبهٔ راست و چرخیده رو به راست.',
        },
      },
    },
    {
      id: 'code',
      title: { en: 'Tell the sketch your pins', fa: 'پایه‌ها را به برنامه بگو' },
      body: {
        en: `Open the **Code** tab and replace each pin number **0** with the pin you wired, for example \`const int TRIG_RIGHT = 4;\`.

The sketch is a small **state machine**: the robot is always in exactly one state, and each pass of \`loop()\` does that state's job and may switch to another.

- **DECIDE**: it stands in the middle of a cell and applies the right-hand rule. After turning right or choosing straight on it switches to FORWARD; after turning left it stays in DECIDE and looks again.
- **FORWARD**: it drives one cell ahead. The front sonar is its tape measure: the cell is done when the wall ahead is 45 cm closer (or, with no wall in sight, after about 1.75 s). On the way it steers to keep the right wall at **WALL_MM**, so it stays in the middle of the corridor.

Open the **Serial monitor** while it runs to watch every decision.`,
        fa: `زبانهٔ **کد** را باز کن و هر شمارهٔ پایهٔ **0** را با پایه‌ای که سیم‌کشی کرده‌ای عوض کن، مثلاً \`const int TRIG_RIGHT = 4;\`.

برنامه یک **ماشین حالت** کوچک است: ربات همیشه دقیقاً در یک حالت است و هر دور \`loop()\` کار همان حالت را انجام می‌دهد و شاید به حالت دیگری برود.

- **DECIDE** (تصمیم): ربات وسط یک خانه ایستاده و قانون دست راست را اجرا می‌کند. بعد از پیچیدن به راست یا انتخاب مستقیم به FORWARD می‌رود؛ بعد از پیچیدن به چپ در DECIDE می‌ماند و دوباره نگاه می‌کند.
- **FORWARD** (جلو): ربات یک خانه جلو می‌رود. سونار جلو متر اوست: وقتی دیوار جلو ۴۵ سانتی‌متر نزدیک‌تر شد، خانه تمام است (یا اگر دیواری دیده نشود، بعد از حدود ۱٫۷۵ ثانیه). در راه هم فرمان می‌دهد تا دیوار راست در فاصلهٔ **WALL_MM** بماند و وسط راهرو حرکت کند.

موقع اجرا **مانیتور سریال** را باز کن تا همهٔ تصمیم‌ها را ببینی.`,
      },
      checks: [
        ...DRIVE_CODE_CHECKS,
        { kind: 'code', use: 'digitalWrite', at: sonar('trig') },
        { kind: 'code', use: 'pinMode', at: sonar('echo') },
      ],
      solution: MAZE_EXPLORER_PINS,
    },
    {
      id: 'run',
      title: { en: 'Time the turn and solve the maze', fa: 'زمان پیچیدن را تنظیم کن و هزارتو را حل کن' },
      body: {
        en: `One blank is left: \`TURN_MS\`, how long the wheels spin in opposite directions for a **90°** turn. At **0** the robot never turns. Start around **350–400 ms**, press **Run** and watch the first turn: the robot should end up square in the new corridor. Then let it find the goal in the top-right corner.`,
        fa: `یک جای خالی مانده: \`TURN_MS\`، این‌که چرخ‌ها چند میلی‌ثانیه خلاف هم بچرخند تا ربات **۹۰ درجه** بپیچد. با **0** ربات هیچ‌وقت نمی‌پیچد. از حدود **۳۵۰ تا ۴۰۰ میلی‌ثانیه** شروع کن، **اجرا** را بزن و اولین پیچ را تماشا کن: ربات باید صاف در راهروی جدید قرار بگیرد. بعد بگذار هدف را در گوشهٔ بالا راست پیدا کند.`,
      },
      checks: [{ kind: 'run' }],
      solution: MAZE_EXPLORER_TURN,
      hints: {
        notRun: {
          en: 'Run the robot until it reaches the goal. If it ends up crooked after a turn, change TURN_MS (bigger turns farther). If it follows the wrong wall or hits walls on the right, check that the right sonar is on the RIGHT edge facing right and wired to TRIG_RIGHT/ECHO_RIGHT.',
          fa: 'ربات را اجرا کن تا به هدف برسد. اگر بعد از پیچیدن کج می‌ماند، TURN_MS را عوض کن (عدد بزرگ‌تر یعنی پیچ بیشتر). اگر دیوار اشتباهی را دنبال می‌کند یا به دیوارهای راست می‌خورد، مطمئن شو سونار راست روی لبهٔ راست و رو به راست است و به TRIG_RIGHT/ECHO_RIGHT وصل شده.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [
      ...DRIVE_PARTS,
      part('sonarF', SONAR, g(40), g(36), { mount: slot('front-top') }),
      part('sonarR', SONAR, g(40), g(44), { mount: { x: 40, y: -55, z: 45, yaw: -90 } }),
    ],
    [
      ...DRIVE_WIRES,
      ['board.5V', 'sonarF.vcc'],
      ['sonarF.gnd', 'board.GND3'],
      ['board.D12', 'sonarF.trig'],
      ['sonarF.echo', 'board.D11'],
      ['board.5V', 'sonarR.vcc'],
      ['sonarR.gnd', 'board.GND3'],
      ['board.D4', 'sonarR.trig'],
      ['sonarR.echo', 'board.D3'],
    ],
    MAZE_EXPLORER_SOLUTION_SKETCH,
  ),
  assets: { base: BASE_SVG, pwm: PWM_SVG, rule: RULE_SVG, sonars: SONARS_SVG },
};
