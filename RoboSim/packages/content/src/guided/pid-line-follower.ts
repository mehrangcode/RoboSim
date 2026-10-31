import type { GuidedCheckInput } from '@robosim/shared';
import { figureEightArena, figureEightChallenge } from '../arenas/line-tracks.js';
import { BASE_SVG, PWM_SVG } from './assets.js';
import { DRIVE_CODE_CHECKS, DRIVE_STEPS, introStep } from './drive-steps.js';
import { DRIVE_PARTS, DRIVE_WIRES, finished, g, part, robotBase, slot } from './robot.js';
import {
  PID_LINE_FOLLOWER_GAINS,
  PID_LINE_FOLLOWER_PINS,
  PID_LINE_FOLLOWER_SOLUTION_SKETCH,
  PID_LINE_FOLLOWER_STARTER_SKETCH,
} from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'pid-line-follower';
const VERSION = 1;
const SENSOR = 'sensor.line-5ch';
const sensor = (pin: string) => ({ type: SENSOR, pin });
const EYES = ['s1', 's2', 's3', 's4', 's5'] as const;

/* Inline art: own light card so it reads the same in both themes, no text so it serves both languages. */
const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<rect width="${w}" height="${h}" rx="12" fill="#f5f2ea"/>${body}</svg>`;

/** A small top-view robot, front to the right, with a wide 5-eye sensor bar at its nose. */
const bot = (x: number, y: number, angle: number, scale = 1): string =>
  `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">` +
  `<rect x="-40" y="-27" width="62" height="54" rx="9" fill="#d9c9a3" stroke="#8a7650" stroke-width="2"/>` +
  `<rect x="-14" y="-35" width="26" height="10" rx="3" fill="#333"/>` +
  `<rect x="-14" y="25" width="26" height="10" rx="3" fill="#333"/>` +
  `<rect x="-26" y="-14" width="30" height="28" rx="3" fill="#1f6fa8"/>` +
  `<rect x="22" y="-24" width="8" height="48" rx="2" fill="#2e7d32"/>` +
  `</g>`;

const COVER = svg(
  320,
  180,
  `<path d="M160 90 C200 30 290 30 290 90 C290 150 200 150 160 90 C120 30 30 30 30 90 C30 150 120 150 160 90 Z" fill="none" stroke="#222" stroke-width="12"/>` +
    bot(230, 140, 0, 0.55),
);

/** The sensor bar seen from above over a line under S4: the five eyes, their weights, the line. */
const ERROR_SVG = svg(
  300,
  140,
  `<rect x="20" y="40" width="260" height="56" rx="6" fill="#2e7d32"/>` +
    `<rect x="190" y="10" width="26" height="120" fill="#222" opacity="0.85"/>` +
    [50, 100, 150, 200, 250]
      .map(
        (cx, i) =>
          `<circle cx="${cx}" cy="68" r="11" fill="${i === 3 ? '#ff5252' : '#ffcdd2'}" stroke="#1b1b1b" stroke-width="1.5"/>`,
      )
      .join('') +
    `<path d="M150 112 h50" stroke="#c0392b" stroke-width="4"/><path d="M198 105 l10 7 l-10 7" fill="#c0392b"/>`,
);

/** P alone keeps overshooting the line; PD settles onto it. */
const PD_SVG = svg(
  300,
  150,
  `<path d="M10 75 h280" stroke="#222" stroke-width="8"/>` +
    `<path d="M10 25 C40 25 45 120 75 120 S110 35 140 35 S170 110 200 110 S230 45 260 45 S285 90 290 95" stroke="#c0392b" stroke-width="3" fill="none" stroke-dasharray="7 5"/>` +
    `<path d="M10 25 C60 25 80 70 120 74 S200 75 290 75" stroke="#1f6fa8" stroke-width="4" fill="none"/>`,
);

const starter = robotBase(
  { slug: SLUG, version: VERSION },
  'Smooth line follower (PID)',
  PID_LINE_FOLLOWER_STARTER_SKETCH,
  figureEightArena,
  figureEightChallenge,
);

export const pidLineFollower: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: false,
  minutes: 60,
  arenaId: figureEightArena.id,
  cover: COVER,
  title: { en: 'Smooth Line Follower (PID)', fa: 'ربات تعقیب خط نرم (PID)' },
  summary: {
    en: 'Five sensors tell your robot how far it is off the line, not just which side. Turn that into smooth steering with a PD controller and race round a figure-eight.',
    fa: 'پنج سنسور به رباتت می‌گویند چقدر از خط فاصله دارد، نه فقط کدام طرف است. با یک کنترل‌گر PD این را به فرمان‌دهی نرم تبدیل کن و دور یک پیست هشتی مسابقه بده.',
  },
  steps: [
    introStep(
      `In this project your robot laps a **figure-eight** as smoothly as it can. Instead of jerking left and right, it measures **how far** it is off the line and steers just enough: the idea behind the **PID controller** that drones, cruise control and 3D printers use.

Tip: in the **Robot** view the chassis is labelled **FRONT**, **BACK**, **LEFT** and **RIGHT**. "Left motor" always means the wheel on the robot's own left when it drives forward, not the left of your screen.`,
      `در این پروژه رباتت تا جای ممکن نرم دور یک پیست **هشتی** می‌چرخد. به جای این‌که تند به چپ و راست بپرد، اندازه می‌گیرد **چقدر** از خط دور شده و فقط به همان اندازه فرمان می‌دهد: همان ایدهٔ **کنترل‌گر PID** که در پهپادها، کروز کنترل خودرو و پرینترهای سه‌بعدی به کار می‌رود.

نکته: در نمای **ربات** روی شاسی **جلو**، **عقب**، **چپ** و **راست** نوشته شده. «موتور چپ» یعنی چرخی که وقتی ربات رو به جلو می‌رود در سمت چپِ خودِ ربات است، نه سمت چپ صفحه‌ات.`,
    ),
    ...DRIVE_STEPS,
    {
      id: 'sensor',
      title: { en: 'Add the 5-channel line sensor', fa: 'سنسور خط پنج‌کاناله را اضافه کن' },
      body: {
        en: `The **5-channel line sensor** has five infrared eyes in a row, **S1** on the far left to **S5** on the far right. Each output reads **HIGH** over the black line and **LOW** over the white floor.

Add a **5-channel line sensor** and put it on the robot: it goes under the **front bracket**, so check the FRONT label in the Robot view and keep S1 on the robot's left. Connect **VCC → 5V**, **GND → GND** and **S1–S5** to five digital pins. D5–D10 are taken by the driver, so use for example **D2, D3, D4, D11, D12**.

![Five eyes, each with a weight; the line is under S4](asset:error)

Give each eye a **weight** for where it sits: S1 = −2, S2 = −1, S3 = 0, S4 = 1, S5 = 2. The average weight of the eyes that see black is the **error**: how far right of centre the line is. Line under S4: error 1. Between S4 and S5: 1.5. Centred: 0. Three eyes could only say left, centre or right; five give a number.`,
        fa: `**سنسور خط پنج‌کاناله** پنج چشم مادون‌قرمز در یک ردیف دارد، از **S1** در منتهی‌الیه چپ تا **S5** در منتهی‌الیه راست. هر خروجی روی خط سیاه **HIGH** و روی زمین سفید **LOW** است.

یک **سنسور خط پنج‌کاناله** اضافه کن و روی ربات بگذار: زیر **براکت جلو** قرار می‌گیرد، پس برچسب «جلو» را در نمای ربات نگاه کن و S1 را در سمت چپ ربات نگه دار. **VCC ← 5V**، **GND ← GND** و **S1 تا S5** را به پنج پایهٔ دیجیتال وصل کن. D5 تا D10 را درایور گرفته، پس مثلاً از **D2، D3، D4، D11، D12** استفاده کن.

![پنج چشم، هر کدام با یک وزن؛ خط زیر S4 است](asset:error)

به هر چشم بر اساس جایش یک **وزن** بده: S1 = ۲-، S2 = ۱-، S3 = ۰، S4 = ۱، S5 = ۲. میانگین وزن چشم‌هایی که سیاه می‌بینند می‌شود **خطا**: این‌که خط چقدر سمت راستِ وسط است. خط زیر S4: خطا ۱. بین S4 و S5: ۱٫۵. وسط: ۰. سه چشم فقط می‌توانستند بگویند چپ، وسط یا راست؛ پنج چشم یک عدد می‌دهند.`,
      },
      checks: [
        { kind: 'part', type: SENSOR, onRobot: true },
        { kind: 'boardPin', pin: sensor('vcc'), pinKind: '5v' },
        { kind: 'boardPin', pin: sensor('gnd'), pinKind: 'ground' },
        ...EYES.map((pin): GuidedCheckInput => ({ kind: 'boardPin', pin: sensor(pin), pinKind: 'digital' })),
      ],
    },
    {
      id: 'code',
      title: { en: 'From error to steering', fa: 'از خطا تا فرمان' },
      body: {
        en: `Open the **Code** tab and replace each pin number **0** in the first block with the pin you wired, for example \`const int S4 = 11;\`.

Every 10 ms the sketch reads the five eyes, works out the error and turns it into \`turn\`, a speed difference between the wheels: \`drive(BASE + turn, BASE - turn)\`. With the line on the right the left wheel speeds up and the right one slows down, all through **PWM** on ENA and ENB, so the robot curves instead of jerking.

\`turn\` is built from two parts:

- **P, proportional**: \`KP * error\`. A small error gives a gentle correction, a big one a strong correction. On its own P always arrives too fast: by the time the robot is back on the line it is still turning, so it overshoots and wobbles from side to side.
- **D, derivative**: \`KD * (error - lastError)\`. It looks at how fast the error is **changing**. When the robot swings back towards the line the error shrinks quickly and D steers the other way a little, like braking before a corner. That damps the wobble.

(The **I** of PID adds up the error over time to remove a small steady offset; a line follower rarely needs it.)

Two special cases: if **no eye** sees the line the robot uses \`lastError\` to keep turning towards where it went, and if **four or five eyes** see black it is on the crossing in the middle of the eight, so it drives straight across.`,
        fa: `زبانهٔ **کد** را باز کن و هر شمارهٔ پایهٔ **0** در بلوک اول را با پایه‌ای که سیم‌کشی کرده‌ای عوض کن، مثلاً \`const int S4 = 11;\`.

برنامه هر ۱۰ میلی‌ثانیه پنج چشم را می‌خواند، خطا را حساب می‌کند و آن را به \`turn\` تبدیل می‌کند، یعنی اختلاف سرعت دو چرخ: \`drive(BASE + turn, BASE - turn)\`. وقتی خط سمت راست است چرخ چپ تندتر و چرخ راست آهسته‌تر می‌شود، همه با **PWM** روی ENA و ENB، پس ربات به جای پریدن قوس می‌زند.

\`turn\` از دو بخش ساخته می‌شود:

- **P، تناسبی**: \`KP * error\`. خطای کوچک اصلاح ملایم و خطای بزرگ اصلاح محکم می‌دهد. P به‌تنهایی همیشه دیر ترمز می‌کند: وقتی ربات به خط برمی‌گردد هنوز در حال پیچیدن است، پس از آن رد می‌شود و به چپ و راست تاب می‌خورد.
- **D، مشتق**: \`KD * (error - lastError)\`. به این نگاه می‌کند که خطا با چه سرعتی **تغییر** می‌کند. وقتی ربات به سمت خط برمی‌گردد خطا سریع کم می‌شود و D کمی به سمت مخالف فرمان می‌دهد، مثل ترمز گرفتن قبل از پیچ. این تاب خوردن را آرام می‌کند.

(حرف **I** در PID خطا را در طول زمان جمع می‌زند تا یک انحراف کوچک و ثابت را از بین ببرد؛ ربات تعقیب خط معمولاً به آن نیازی ندارد.)

دو حالت خاص: اگر **هیچ چشمی** خط را نبیند، ربات با \`lastError\` به سمتی که خط رفته بود می‌پیچد، و اگر **چهار یا پنج چشم** سیاه ببینند روی تقاطع وسط هشت است و مستقیم از رویش رد می‌شود.`,
      },
      checks: [
        ...DRIVE_CODE_CHECKS,
        ...EYES.map((pin): GuidedCheckInput => ({ kind: 'code', use: 'digitalRead', at: sensor(pin) })),
      ],
      solution: PID_LINE_FOLLOWER_PINS,
    },
    {
      id: 'run',
      title: { en: 'Tune KP and KD, then race', fa: 'KP و KD را تنظیم کن و مسابقه بده' },
      body: {
        en: `Two blanks are left: the gains \`KP\` and \`KD\`. With both at **0** the robot never steers and drives straight off the track. Tune them the way engineers do:

- **First P:** set **KP** to about **60** and leave KD at 0. Press **Run**: the robot follows the line but wobbles, and may fly off the tight loops.
- **Then D:** raise **KD**, for example to **400**. The wobble dies down and the robot glides round the eight.

![P alone overshoots and wobbles; with D it settles on the line](asset:pd)

Too little KP and the robot cannot make the bends; too much and it zigzags. Too much KD makes it twitchy. Finish a lap of the figure-eight.`,
        fa: `دو جای خالی مانده: ضریب‌های \`KP\` و \`KD\`. وقتی هر دو **0** باشند ربات اصلاً فرمان نمی‌دهد و مستقیم از پیست بیرون می‌رود. مثل مهندس‌ها تنظیمشان کن:

- **اول P:** **KP** را حدود **۶۰** بگذار و KD را 0 نگه دار. **اجرا** را بزن: ربات خط را دنبال می‌کند اما تاب می‌خورد و ممکن است در حلقه‌های تنگ بیرون بزند.
- **بعد D:** حالا **KD** را بالا ببر، مثلاً **۴۰۰**. تاب خوردن آرام می‌شود و ربات نرم دور هشت می‌چرخد.

![P به‌تنهایی از خط رد می‌شود و تاب می‌خورد؛ با D روی خط می‌نشیند](asset:pd)

اگر KP خیلی کم باشد ربات از پس پیچ‌ها برنمی‌آید و اگر خیلی زیاد باشد زیگزاگ می‌رود. KD زیادی هم ربات را عصبی می‌کند. یک دور کامل پیست هشتی را تمام کن.`,
      },
      checks: [{ kind: 'run' }],
      solution: PID_LINE_FOLLOWER_GAINS,
      hints: {
        notRun: {
          en: 'Run the robot for a full lap of the eight. If it drives straight off, KP is still 0. If it zigzags, lower KP or raise KD; if it cannot make the tight loops, raise KP. If it steers away from the line, check that S1 is on the robot’s left (FRONT/LEFT labels in the Robot view) and the motor wires on OUT1–OUT4.',
          fa: 'ربات را برای یک دور کامل هشت اجرا کن. اگر مستقیم بیرون می‌رود، KP هنوز 0 است. اگر زیگزاگ می‌رود KP را کم یا KD را زیاد کن؛ اگر از پس حلقه‌های تنگ برنمی‌آید KP را بیشتر کن. اگر به جای سمت خط به سمت مخالف می‌پیچد، بررسی کن S1 سمت چپ ربات باشد (برچسب‌های جلو/چپ در نمای ربات) و سیم‌های موتور روی OUT1 تا OUT4 درست باشند.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [
      ...DRIVE_PARTS,
      part('line', SENSOR, g(40), g(42), { props: { spacingMm: 15 }, mount: slot('front-bracket') }),
    ],
    [
      ...DRIVE_WIRES,
      ['board.5V', 'line.vcc'],
      ['line.gnd', 'board.GND3'],
      ['line.s1', 'board.D2'],
      ['line.s2', 'board.D3'],
      ['line.s3', 'board.D4'],
      ['line.s4', 'board.D11'],
      ['line.s5', 'board.D12'],
    ],
    PID_LINE_FOLLOWER_SOLUTION_SKETCH,
  ),
  assets: { base: BASE_SVG, pwm: PWM_SVG, error: ERROR_SVG, pd: PD_SVG },
};
