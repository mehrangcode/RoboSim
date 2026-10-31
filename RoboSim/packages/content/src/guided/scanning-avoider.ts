import { obstacleCourseArena, obstacleCourseChallenge } from '../arenas/open-arenas.js';
import { BASE_SVG, PWM_SVG } from './assets.js';
import { DRIVE_CODE_CHECKS, DRIVE_STEPS, introStep } from './drive-steps.js';
import { DRIVE_PARTS, DRIVE_WIRES, finished, g, part, robotBase } from './robot.js';
import {
  SCANNING_AVOIDER_PINS,
  SCANNING_AVOIDER_SOLUTION_SKETCH,
  SCANNING_AVOIDER_STARTER_SKETCH,
} from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'scanning-avoider';
const VERSION = 1;
const SERVO = 'actuator.sg90-servo';
const SONAR = 'sensor.hc-sr04';
const servo = (pin: string) => ({ type: SERVO, pin });
const sonar = (pin: string) => ({ type: SONAR, pin });

/** The servo at the front of the deck (horn axis on the centre line), the sonar on top of its horn. */
const SERVO_MOUNT = { x: 55, y: 0, z: 45, yaw: 0 };
const SONAR_MOUNT = { x: 55, y: 0, z: 75, yaw: 0, onServo: 'neck' };

/* Illustrations (inline SVG, no text so one image serves both languages). */

const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<rect width="${w}" height="${h}" rx="12" fill="#f5f2ea"/>${body}</svg>`;

/** The robot from above, front to the right, with the servo and the sonar on its horn turned by `deg`. */
const robotWithHead = (x: number, y: number, deg: number): string =>
  `<g transform="translate(${x} ${y})">` +
  `<rect x="0" y="10" width="150" height="100" rx="14" fill="#d9c9a3" stroke="#8a7650" stroke-width="2"/>` +
  `<rect x="34" y="-4" width="44" height="16" rx="4" fill="#333"/>` +
  `<rect x="34" y="108" width="44" height="16" rx="4" fill="#333"/>` +
  `<rect x="40" y="32" width="64" height="48" rx="4" fill="#1f6fa8"/>` +
  `<rect x="112" y="48" width="26" height="24" rx="3" fill="#1e88e5"/>` +
  `<g transform="rotate(${-deg} 128 60)">` +
  `<rect x="122" y="38" width="16" height="44" rx="4" fill="#1565c0"/>` +
  `<circle cx="141" cy="50" r="5" fill="#cfd8dc"/><circle cx="141" cy="70" r="5" fill="#cfd8dc"/>` +
  [14, 26]
    .map(
      (r) =>
        `<path d="M${148 + r} ${60 - r} a${r} ${r} 0 0 1 0 ${2 * r}" stroke="#1565c0" stroke-width="2.5" fill="none"/>`,
    )
    .join('') +
  `</g></g>`;

const COVER = svg(
  320,
  180,
  `<rect x="215" y="40" width="22" height="100" rx="3" fill="#a1887f"/>` +
    `<circle cx="290" cy="40" r="16" fill="none" stroke="#2e7d32" stroke-width="4" stroke-dasharray="6 4"/>` +
    `<path d="M150 90 m-40 -60 a72 72 0 0 1 0 120" stroke="#90a4ae" stroke-width="2" stroke-dasharray="4 4" fill="none" transform="translate(90 0)"/>` +
    `<g transform="translate(20 40) scale(0.85)">${robotWithHead(0, 0, 35)}</g>`,
);

/** The SG90 at the front, the sonar on its horn looking left, ahead and right. */
const NECK_SVG = svg(
  300,
  160,
  `<g opacity="0.35">${robotWithHead(40, 20, 60)}</g>` +
    `<g opacity="0.35">${robotWithHead(40, 20, -60)}</g>` +
    robotWithHead(40, 20, 0),
);

/** The sonar on the servo horn. */
const SERVO_SVG = svg(240, 150, robotWithHead(30, 15, 0));

const starter = robotBase(
  { slug: SLUG, version: VERSION },
  'Scanning obstacle avoider',
  SCANNING_AVOIDER_STARTER_SKETCH,
  obstacleCourseArena,
  obstacleCourseChallenge,
);

export const scanningAvoider: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: false,
  minutes: 60,
  arenaId: obstacleCourseArena.id,
  cover: COVER,
  title: { en: 'Scanning Obstacle Avoider', fa: 'ربات مانع‌گریز با سر چرخان' },
  summary: {
    en: 'Put the sonar on a servo so your robot can turn its head: it stops at an obstacle, looks left and right, and takes the side with more room.',
    fa: 'سونار را روی یک سروو سوار کن تا ربات بتواند سرش را بچرخاند: جلوی مانع می‌ایستد، به چپ و راست نگاه می‌کند و از طرفی می‌رود که جای بیشتری دارد.',
  },
  steps: [
    introStep(
      'In this project you build a robot that crosses the obstacle course to the goal. Instead of a sonar fixed to the front, it gets a head that turns: the sonar sits on a servo, so the robot can look around before it chooses a way.',
      'در این پروژه رباتی می‌سازی که از مسیر پر از مانع تا هدف می‌رود. به‌جای سوناری که ثابت به جلوی ربات بسته شده، ربات یک سر چرخان دارد: سونار روی یک سروو سوار است تا ربات قبل از انتخاب راه، اطرافش را نگاه کند.',
    ),
    ...DRIVE_STEPS,
    {
      id: 'servo',
      title: { en: 'Give the robot a neck', fa: 'به ربات گردن بده' },
      body: {
        en: `A **servo** turns its **horn** to an exact angle between 0° and 180° and holds it. Standing horn-up at the front of the robot, **90°** looks straight ahead, **180°** looks left and **0°** looks right.

![The servo at the front of the robot](asset:servo)

Add an **SG90 micro servo** and put it on the robot at the **front of the deck**, facing forward. Then wire it:

- **signal** (orange) → a digital pin, for example **D3**. The Servo library can use any digital pin; it borrows Timer1, which switches off \`analogWrite\` on D9 and D10. That is fine here, because the driver's IN3 and IN4 on those pins only need \`digitalWrite\`, and ENA and ENB stay on D5 and D6.
- **vcc** (red) → the battery side of the **switch** (where the driver's **VS** goes). A moving servo can draw up to 650 mA, more than the Uno's 5V pin should give; the 6 V pack suits the SG90.
- **gnd** (brown) → **GND** on the Uno.`,
        fa: `**سروو** بازوی خودش را دقیقاً به زاویه‌ای بین ۰ تا ۱۸۰ درجه می‌چرخاند و همان‌جا نگه می‌دارد. اگر سروو را جلوی ربات با بازوی رو به بالا ببندی، **۹۰ درجه** یعنی رو به جلو، **۱۸۰ درجه** یعنی چپ و **۰ درجه** یعنی راست.

![سروو جلوی ربات](asset:servo)

یک **میکروسروو SG90** اضافه کن و آن را روی ربات، **جلوی طبقهٔ بالا** و رو به جلو بگذار. بعد سیم‌کشی کن:

- **signal** (نارنجی) ← یک پایهٔ دیجیتال، مثلاً **D3**. کتابخانهٔ Servo با هر پایهٔ دیجیتالی کار می‌کند، ولی Timer1 را قرض می‌گیرد و \`analogWrite\` روی D9 و D10 خاموش می‌شود. این‌جا مشکلی نیست، چون IN3 و IN4 درایور روی این پایه‌ها فقط \`digitalWrite\` لازم دارند و ENA و ENB روی D5 و D6 می‌مانند.
- **vcc** (قرمز) ← سمت باتری **کلید** (همان‌جایی که **VS** درایور وصل است). سروو موقع حرکت تا ۶۵۰ میلی‌آمپر جریان می‌کشد که برای پایهٔ 5V آردوینو زیاد است؛ جاباتری ۶ ولتی برای SG90 مناسب است.
- **gnd** (قهوه‌ای) ← **GND** آردوینو.`,
      },
      checks: [
        { kind: 'part', type: SERVO, onRobot: true },
        { kind: 'boardPin', pin: servo('signal'), pinKind: 'digital' },
        { kind: 'connected', a: servo('vcc'), b: { type: 'power.switch', pin: 'b' } },
        { kind: 'boardPin', pin: servo('gnd'), pinKind: 'ground' },
      ],
      hints: {
        notConnected: {
          en: 'The servo’s vcc goes to the switch’s b pin (the battery side that also feeds the driver’s VS), not to the Uno’s 5V.',
          fa: 'vcc سروو به پایهٔ b کلید می‌رود (سمت باتری که به VS درایور هم وصل است)، نه به 5V آردوینو.',
        },
      },
    },
    {
      id: 'sonar',
      title: { en: 'Put the sonar on the servo', fa: 'سونار را روی سروو سوار کن' },
      body: {
        en: `Now the head. Add an **HC-SR04** sonar and put it on the robot. Then, in the **Robot** view, select it and pick your servo under **Mount on servo**: the sonar jumps onto the horn and from now on turns with it.

![The sonar looking left, ahead and right](asset:neck)

Wire it like a fixed sonar: **VCC → 5V**, **GND → GND**, and **TRIG** and **ECHO** to two digital pins, for example **D12** and **D11**.`,
        fa: `حالا نوبت سر است. یک سونار **HC-SR04** اضافه کن و روی ربات بگذار. بعد در نمای **ربات** انتخابش کن و از **سوار روی سروو** سرووی خودت را انتخاب کن: سونار روی بازوی سروو می‌رود و از این به بعد با آن می‌چرخد.

![سونار به چپ، جلو و راست نگاه می‌کند](asset:neck)

سیم‌کشی‌اش مثل سونار ثابت است: **VCC ← 5V**، **GND ← GND** و **TRIG** و **ECHO** به دو پایهٔ دیجیتال، مثلاً **D12** و **D11**.`,
      },
      checks: [
        { kind: 'part', type: SONAR, onServo: true },
        { kind: 'boardPin', pin: sonar('vcc'), pinKind: '5v' },
        { kind: 'boardPin', pin: sonar('gnd'), pinKind: 'ground' },
        { kind: 'boardPin', pin: sonar('trig'), pinKind: 'digital' },
        { kind: 'boardPin', pin: sonar('echo'), pinKind: 'digital' },
      ],
    },
    {
      id: 'code',
      title: { en: 'Tell the sketch your pins', fa: 'پایه‌ها را به برنامه بگو' },
      body: {
        en: `Open the **Code** tab. Replace each pin number **0** with the pin you wired, for example \`const int SERVO_PIN = 3;\`.

While it drives, the head keeps glancing ahead, a little right and a little left (\`GLANCE\`), and \`inPath()\` works out whether an echo is in front of the wheels and nearer than \`TOO_CLOSE\`. That way a corner beside the robot is spotted too, not only what is straight ahead. When something is in the way, the robot stops (and backs up a little if it is very close) and calls \`look(LEFT, …)\` and \`look(RIGHT, …)\`: each turns the servo with \`neck.write(angle)\`, waits for the horn to get there and measures. The robot turns towards the side with more room, in small steps, until it sees open space ahead, and remembers how far it turned. Once it has driven past, it looks back towards the goal and turns back when that way is clear.`,
        fa: `زبانهٔ **کد** را باز کن. هر شمارهٔ پایهٔ **0** را با پایه‌ای که سیم‌کشی کرده‌ای عوض کن، مثلاً \`const int SERVO_PIN = 3;\`.

وقتی ربات حرکت می‌کند، سرش مدام به جلو، کمی راست و کمی چپ نگاه می‌کند (\`GLANCE\`) و \`inPath()\` حساب می‌کند که پژواک جلوی چرخ‌هاست و نزدیک‌تر از \`TOO_CLOSE\` است یا نه. این‌طوری گوشهٔ مانعی که کنار ربات است هم دیده می‌شود، نه فقط چیزی که درست جلویش است. وقتی چیزی سر راه باشد، ربات می‌ایستد (اگر خیلی نزدیک باشد کمی عقب می‌رود) و \`look(LEFT, …)\` و \`look(RIGHT, …)\` را صدا می‌زند: هر کدام سروو را با \`neck.write(angle)\` می‌چرخاند، صبر می‌کند تا بازو برسد و فاصله را اندازه می‌گیرد. ربات قدم‌به‌قدم به طرفی می‌چرخد که جای بیشتری دارد تا جلویش باز شود، و یادش می‌ماند چقدر چرخیده. وقتی از مانع رد شد، به سمت هدف نگاه می‌کند و اگر آن طرف باز بود، برمی‌گردد.`,
      },
      checks: [
        ...DRIVE_CODE_CHECKS,
        { kind: 'code', use: 'digitalWrite', at: sonar('trig') },
        { kind: 'code', use: 'pinMode', at: sonar('echo') },
        { kind: 'code', use: 'servo', at: servo('signal') },
      ],
      solution: SCANNING_AVOIDER_PINS,
    },
    {
      id: 'run',
      title: { en: 'Look around and reach the goal', fa: 'اطرافت را نگاه کن و به هدف برس' },
      body: {
        en: `Press **Run** and watch the sonar's cone in the arena: it swings left and right each time the robot stops. Get to the goal on the right.

Want to experiment? \`TOO_CLOSE\` is how near something may get before the robot stops to look. Anything from **20 to 35 cm** gets it to the goal: smaller values squeeze past obstacles, bigger ones turn away earlier. Try a few and watch how its path changes.`,
        fa: `**اجرا** را بزن و مخروط سونار را در زمین تماشا کن: هر بار که ربات می‌ایستد، به چپ و راست می‌چرخد. به هدف سمت راست برس.

دوست داری آزمایش کنی؟ \`TOO_CLOSE\` یعنی چیزی تا چه فاصله‌ای می‌تواند نزدیک شود تا ربات بایستد و نگاه کند. هر عددی از **۲۰ تا ۳۵ سانتی‌متر** ربات را به هدف می‌رساند: عددهای کوچک‌تر از نزدیکِ مانع‌ها رد می‌شوند و عددهای بزرگ‌تر زودتر دور می‌زنند. چند تا را امتحان کن و ببین مسیرش چطور عوض می‌شود.`,
      },
      checks: [{ kind: 'run' }],
      hints: {
        notRun: {
          en: 'Run the robot until it reaches the goal. If the sonar does not turn, check SERVO_PIN and the servo’s power; if it turns but the robot hits things, check that the sonar is mounted on the servo in the Robot view. Wandering for a long time? Keep TOO_CLOSE between 20 and 35.',
          fa: 'ربات را اجرا کن تا به هدف برسد. اگر سونار نمی‌چرخد، SERVO_PIN و برق سروو را بررسی کن؛ اگر می‌چرخد ولی ربات به مانع می‌خورد، در نمای ربات ببین سونار روی سروو سوار شده باشد. مدت زیادی سرگردان است؟ TOO_CLOSE را بین 20 و 35 نگه دار.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [
      ...DRIVE_PARTS,
      part('neck', SERVO, g(44), g(16), { mount: SERVO_MOUNT }),
      part('sonar', SONAR, g(40), g(40), { mount: SONAR_MOUNT }),
    ],
    [
      ...DRIVE_WIRES,
      ['sw.b', 'neck.vcc'],
      ['neck.gnd', 'board.GND3'],
      ['board.D3', 'neck.signal'],
      ['board.5V', 'sonar.vcc'],
      ['sonar.gnd', 'board.GND3'],
      ['board.D12', 'sonar.trig'],
      ['sonar.echo', 'board.D11'],
    ],
    SCANNING_AVOIDER_SOLUTION_SKETCH,
  ),
  assets: { base: BASE_SVG, pwm: PWM_SVG, servo: SERVO_SVG, neck: NECK_SVG },
};
