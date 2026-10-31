import type { GuidedCheckInput } from '@robosim/shared';
import { squareArena, squareChallenge } from '../arenas/line-tracks.js';
import { BASE_SVG, LINE_SENSOR_SVG, PWM_SVG } from './assets.js';
import { DRIVE_CODE_CHECKS, DRIVE_STEPS, introStep } from './drive-steps.js';
import { DRIVE_PARTS, DRIVE_WIRES, finished, g, part, robotBase, slot } from './robot.js';
import { SQUARE_TRACK_PINS, SQUARE_TRACK_SOLUTION_SKETCH, SQUARE_TRACK_STARTER_SKETCH } from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'square-track';
const VERSION = 1;
const SENSOR = 'sensor.line-3ch';
const sensor = (pin: string) => ({ type: SENSOR, pin });

/* Inline art: own light card so it reads the same in both themes, no text so it serves both languages. */
const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<rect width="${w}" height="${h}" rx="12" fill="#f5f2ea"/>${body}</svg>`;

/** A small top-view robot, front to the right, with the line sensor at its nose. */
const bot = (x: number, y: number, angle: number, scale = 1): string =>
  `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">` +
  `<rect x="-40" y="-27" width="62" height="54" rx="9" fill="#d9c9a3" stroke="#8a7650" stroke-width="2"/>` +
  `<rect x="-14" y="-35" width="26" height="10" rx="3" fill="#333"/>` +
  `<rect x="-14" y="25" width="26" height="10" rx="3" fill="#333"/>` +
  `<rect x="-26" y="-14" width="30" height="28" rx="3" fill="#1f6fa8"/>` +
  `<rect x="22" y="-12" width="8" height="24" rx="2" fill="#2e7d32"/>` +
  `</g>`;

const COVER = svg(
  320,
  180,
  `<rect x="40" y="30" width="240" height="120" fill="none" stroke="#222" stroke-width="12" stroke-linejoin="miter"/>` +
    `<path d="M248 136 a22 22 0 0 0 22 -22" stroke="#c0392b" stroke-width="3" fill="none" stroke-dasharray="5 4"/>` +
    `<path d="M266 118 l4 -6 l4 7" stroke="#c0392b" stroke-width="3" fill="none"/>` +
    bot(205, 150, 0, 0.55),
);

/** A spin turn: the left wheel backward, the right forward, the robot turns on the spot. */
const SPIN_SVG = svg(
  260,
  160,
  `<rect x="143" y="8" width="14" height="94" fill="#222"/><rect x="10" y="88" width="147" height="14" fill="#222"/>` +
    bot(150, 95, 0) +
    `<path d="M180 50 h-48" stroke="#c0392b" stroke-width="4"/><path d="M134 43 l-10 7 l10 7" fill="#c0392b"/>` +
    `<path d="M120 142 h48" stroke="#2e7d32" stroke-width="4"/><path d="M166 135 l10 7 l-10 7" fill="#2e7d32"/>` +
    `<path d="M200 95 a50 50 0 0 0 -50 -50" stroke="#555" stroke-width="2.5" fill="none" stroke-dasharray="5 4"/>` +
    `<path d="M158 38 l-9 7 l9 6" stroke="#555" stroke-width="2.5" fill="none"/>`,
);

const starter = robotBase(
  { slug: SLUG, version: VERSION },
  'Square track: sharp corners',
  SQUARE_TRACK_STARTER_SKETCH,
  squareArena,
  squareChallenge,
);

export const squareTrack: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: false,
  minutes: 50,
  arenaId: squareArena.id,
  cover: COVER,
  title: { en: 'Square Track: Sharp Corners', fa: 'پیست مربعی: پیچ‌های تند' },
  summary: {
    en: 'A track with four 90° corners: teach your line follower to notice a corner and spin on the spot, one wheel forward and one backward.',
    fa: 'پیستی با چهار پیچ ۹۰ درجه: به ربات تعقیب خطت یاد بده پیچ را تشخیص بدهد و درجا بچرخد، یک چرخ رو به جلو و یکی رو به عقب.',
  },
  steps: [
    introStep(
      `In this project your robot follows a line around a **square** with four sharp 90° corners. A gentle line follower overshoots a corner like that and loses the line, so you will teach it a new move: the **spin turn**.

Tip: in the **Robot** view the chassis is labelled **FRONT**, **BACK**, **LEFT** and **RIGHT**. "Left motor" always means the wheel on the robot's own left when it drives forward, not the left of your screen.`,
      `در این پروژه رباتت خط را دور یک **مربع** با چهار پیچ تند ۹۰ درجه دنبال می‌کند. ربات تعقیب خط معمولی از چنین پیچی رد می‌شود و خط را گم می‌کند، پس یک حرکت تازه یادش می‌دهی: **چرخش درجا**.

نکته: در نمای **ربات** روی شاسی **جلو**، **عقب**، **چپ** و **راست** نوشته شده. «موتور چپ» یعنی چرخی که وقتی ربات رو به جلو می‌رود در سمت چپِ خودِ ربات است، نه سمت چپ صفحه‌ات.`,
    ),
    ...DRIVE_STEPS,
    {
      id: 'sensor',
      title: { en: 'Add the line sensor', fa: 'سنسور خط را اضافه کن' },
      body: {
        en: `The **3-channel line sensor** has three infrared eyes, **L**, **C** and **R**. Each output reads **HIGH** over the black line and **LOW** over the white floor.

![The line sensor under the front of the robot](asset:sensor)

Add a **3-channel line sensor** and put it on the robot: it goes under the **front bracket**, so check the FRONT label in the Robot view. Connect **VCC → 5V**, **GND → GND** and **L, C, R** to three digital pins, for example **D2, D3, D4**.

**How does the robot spot a corner?** On a straight line at least one eye is always on the tape. At a 90° corner the tape suddenly turns sideways, so first one **outer** eye sees black on its own, then a moment later **all three see white**: the line has ended under the sensor. The side the outer eye saw last is the way to turn.`,
        fa: `**سنسور خط سه‌کاناله** سه چشم مادون‌قرمز دارد: **L**، **C** و **R**. هر خروجی روی خط سیاه **HIGH** و روی زمین سفید **LOW** است.

![سنسور خط زیر جلوی ربات](asset:sensor)

یک **سنسور خط سه‌کاناله** اضافه کن و روی ربات بگذار: زیر **براکت جلو** قرار می‌گیرد، پس برچسب «جلو» را در نمای ربات نگاه کن. **VCC ← 5V**، **GND ← GND** و **L، C، R** را به سه پایهٔ دیجیتال وصل کن، مثلاً **D2، D3، D4**.

**ربات پیچ را چطور تشخیص می‌دهد؟** روی خط صاف همیشه دست‌کم یکی از چشم‌ها روی نوار است. در پیچ ۹۰ درجه نوار ناگهان به پهلو می‌رود؛ اول فقط یکی از چشم‌های **کناری** سیاه می‌بیند و کمی بعد **هر سه سفید می‌بینند**: خط زیر سنسور تمام شده. سمتی که چشم کناری آخرین بار خط را دید، همان سمتی است که باید بپیچی.`,
      },
      checks: [
        { kind: 'part', type: SENSOR, onRobot: true },
        { kind: 'boardPin', pin: sensor('vcc'), pinKind: '5v' },
        { kind: 'boardPin', pin: sensor('gnd'), pinKind: 'ground' },
        ...(['left', 'center', 'right'] as const).map((pin): GuidedCheckInput => ({
          kind: 'boardPin',
          pin: sensor(pin),
          pinKind: 'digital',
        })),
      ],
    },
    {
      id: 'code',
      title: { en: 'Spin turns in code', fa: 'چرخش درجا در کد' },
      body: {
        en: `Open the **Code** tab and replace each pin number **0** with the pin you wired, for example \`const int IN2 = 8;\`.

This sketch drives with \`drive(left, right)\`: each speed goes from **−255 to 255**. A positive number sets **IN1** (or **IN3**) HIGH and the wheel turns forward; a negative one sets **IN2** (or **IN4**) HIGH and the wheel turns **backward**. That is why this time the sketch needs the IN2 and IN4 wires you made earlier.

![A spin turn: one wheel backward, one forward](asset:spin)

- **Gentle turn** (\`drive(SPEED / 4, SPEED)\`): one wheel slower. The robot draws a wide curve, fine for small corrections.
- **Spin turn** (\`drive(-SPIN, SPIN)\`): the wheels turn opposite ways, so the robot turns on the spot around the middle of its axle. A sharp corner needs exactly that.

The sensor sits about 6 cm in front of the wheels. When the line ends the robot first rolls on for \`OVERSHOOT\` ms so the **wheels** are over the corner, then spins towards \`turnTo\` until the centre eye finds the new line.`,
        fa: `زبانهٔ **کد** را باز کن و هر شمارهٔ پایهٔ **0** را با پایه‌ای که سیم‌کشی کرده‌ای عوض کن، مثلاً \`const int IN2 = 8;\`.

این برنامه با \`drive(left, right)\` حرکت می‌کند: هر سرعت از **۲۵۵-** تا **۲۵۵** است. عدد مثبت **IN1** (یا **IN3**) را HIGH می‌کند و چرخ رو به جلو می‌چرخد؛ عدد منفی **IN2** (یا **IN4**) را HIGH می‌کند و چرخ **رو به عقب** می‌چرخد. برای همین این بار برنامه به سیم‌های IN2 و IN4 که قبلاً وصل کردی نیاز دارد.

![چرخش درجا: یک چرخ رو به عقب، یکی رو به جلو](asset:spin)

- **پیچ نرم** (\`drive(SPEED / 4, SPEED)\`): یک چرخ آهسته‌تر می‌چرخد. ربات یک قوس پهن می‌زند که برای اصلاح‌های کوچک خوب است.
- **چرخش درجا** (\`drive(-SPIN, SPIN)\`): چرخ‌ها خلاف هم می‌چرخند و ربات درجا دور وسط محورش می‌چرخد. پیچ تند دقیقاً همین را لازم دارد.

سنسور حدود ۶ سانتی‌متر جلوتر از چرخ‌هاست. وقتی خط تمام می‌شود، ربات اول \`OVERSHOOT\` میلی‌ثانیه جلو می‌رود تا **چرخ‌ها** روی پیچ برسند، بعد به سمت \`turnTo\` درجا می‌چرخد تا چشم وسط خط تازه را پیدا کند.`,
      },
      checks: [
        ...DRIVE_CODE_CHECKS,
        ...(['left', 'center', 'right'] as const).map((pin): GuidedCheckInput => ({
          kind: 'code',
          use: 'digitalRead',
          at: sensor(pin),
        })),
      ],
      solution: SQUARE_TRACK_PINS,
    },
    {
      id: 'run',
      title: { en: 'Run a lap', fa: 'یک دور بزن' },
      body: {
        en: 'Press **Run**. Watch each corner: the robot rolls a little past it, spins on the spot and carries on along the next side. Finish a full lap of the square.',
        fa: '**اجرا** را بزن. پیچ‌ها را تماشا کن: ربات کمی از پیچ رد می‌شود، درجا می‌چرخد و در ضلع بعدی ادامه می‌دهد. یک دور کامل مربع را تمام کن.',
      },
      checks: [{ kind: 'run' }],
      hints: {
        notRun: {
          en: 'Run the robot for a full lap. If it spins the wrong way at a corner or never stops spinning, a motor is probably on the wrong side or wired backwards: check the LEFT/RIGHT labels in the Robot view and the OUT1–OUT4 wires. If it turns too early or too late, change OVERSHOOT.',
          fa: 'ربات را برای یک دور کامل اجرا کن. اگر سر پیچ به سمت اشتباه می‌چرخد یا چرخیدنش تمام نمی‌شود، احتمالاً یک موتور در سمت اشتباه است یا برعکس وصل شده: برچسب‌های چپ/راست را در نمای ربات و سیم‌های OUT1 تا OUT4 را بررسی کن. اگر خیلی زود یا خیلی دیر می‌پیچد، OVERSHOOT را تغییر بده.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [
      ...DRIVE_PARTS,
      part('line', SENSOR, g(40), g(42), { props: { spacingMm: 12 }, mount: slot('front-bracket') }),
    ],
    [
      ...DRIVE_WIRES,
      ['board.5V', 'line.vcc'],
      ['line.gnd', 'board.GND3'],
      ['line.left', 'board.D2'],
      ['line.center', 'board.D3'],
      ['line.right', 'board.D4'],
    ],
    SQUARE_TRACK_SOLUTION_SKETCH,
  ),
  assets: { base: BASE_SVG, pwm: PWM_SVG, sensor: LINE_SENSOR_SVG, spin: SPIN_SVG },
};
