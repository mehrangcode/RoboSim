import { benchBase } from './bench.js';
import { card, uno, wire } from './bench-art.js';
import { finished, g, part } from './robot.js';
import { SERVO_SWEEP_PINS, SERVO_SWEEP_SOLUTION_SKETCH, SERVO_SWEEP_STARTER_SKETCH } from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'servo-sweep';
const VERSION = 1;
const SERVO = 'actuator.sg90-servo';
const PACK = 'power.battery-4aa';
const servo = (pin: string) => ({ type: SERVO, pin });
const pack = (pin: string) => ({ type: PACK, pin });

const starter = benchBase({ slug: SLUG, version: VERSION }, 'Servo Sweep', SERVO_SWEEP_STARTER_SKETCH, {
  id: 'one-sweep',
  condition: {
    all: [
      { type: 'serialMatches', pattern: 'Angle: 180\\b' },
      { type: 'serialMatches', pattern: 'Sweep 1 done' },
      { type: 'timeLimit', seconds: 60 },
    ],
  },
});

/** SG90 from above with its horn at `angle` (0 = pointing left, 180 = right). */
const sg90 = (x: number, y: number, angle: number): string => {
  const a = (angle * Math.PI) / 180;
  const hx = (-34 * Math.cos(a)).toFixed(1);
  const hy = (-34 * Math.sin(a)).toFixed(1);
  return (
    `<g transform="translate(${x} ${y})">` +
    `<rect x="-40" y="-10" width="80" height="40" rx="4" fill="#1e88e5"/>` +
    `<rect x="-52" y="4" width="104" height="10" rx="2" fill="#1e88e5"/>` +
    `<circle cx="0" cy="0" r="12" fill="#eceff1"/>` +
    `<path d="M0 0 L${hx} ${hy}" stroke="#eceff1" stroke-width="9" stroke-linecap="round"/>` +
    `<circle cx="0" cy="0" r="4" fill="#90a4ae"/>` +
    `</g>`
  );
};

/** The horn's swing, 0° to 180°. */
const ARC = (x: number, y: number, r: number): string =>
  `<path d="M${x - r} ${y} A${r} ${r} 0 0 1 ${x + r} ${y}" fill="none" stroke="#fb8c00" stroke-width="3" stroke-dasharray="6 5"/>` +
  `<path d="M${x + r - 6} ${y - 8} l6 8 l6 -8" fill="none" stroke="#fb8c00" stroke-width="3"/>`;

/** The pack feeds the servo, the Uno only sends the signal; the grounds are joined. */
const POWER_SVG = card(
  320,
  150,
  uno(14, 40) +
    `<rect x="180" y="96" width="120" height="40" rx="4" fill="#444"/>` +
    `<rect x="186" y="102" width="24" height="28" rx="2" fill="#c0392b"/>` +
    sg90(240, 40, 60) +
    wire('124,56 160,56 160,62 188,62', '#fb8c00') +
    wire('196,96 196,74', '#e53935') +
    wire('124,108 160,108 160,124 180,124', '#222') +
    wire('214,74 214,86 290,86 290,96', '#222'),
);

const SERVO_COVER = card(
  320,
  180,
  uno(20, 70) + ARC(220, 100, 64) + sg90(220, 100, 135) + wire('130,86 170,86 170,108 180,108', '#fb8c00'),
);

export const servoSweep: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: true,
  minutes: 20,
  arenaId: null,
  cover: SERVO_COVER,
  title: { en: 'Servo Sweep', fa: 'جاروب سروو' },
  summary: {
    en: 'Make a hobby servo swing from 0° to 180° and back with the Servo library, and power it properly from its own battery pack.',
    fa: 'با کتابخانهٔ Servo یک سروو را از ۰ تا ۱۸۰ درجه و برعکس بچرخان و برقش را درست، از جاباتری خودش، تأمین کن.',
  },
  steps: [
    {
      id: 'intro',
      title: { en: 'A motor that goes to an angle', fa: 'موتوری که به یک زاویه می‌رود' },
      body: {
        en: `A normal motor just spins. A **servo** has a small motor, a gearbox and a sensor inside, so it turns its **horn** to an exact angle between **0° and 180°** and holds it there. Servos steer model cars, move robot arms and open little doors.

You tell it the angle with pulses on one signal wire: 50 times a second the Arduino sends a pulse, about **0.5 ms** long for 0° up to **2.5 ms** for 180°. You never time those pulses yourself: the **Servo** library does it, and you just write \`horn.write(90);\`.

In this project the servo sweeps from 0° to 180° and back, and prints its progress on the **Serial Monitor**. Each step turns green by itself when your circuit is right.`,
        fa: `یک موتور معمولی فقط می‌چرخد. **سروو** داخلش یک موتور کوچک، گیربکس و یک سنسور دارد، پس **بازو**یش را دقیقاً به زاویه‌ای بین **۰ تا ۱۸۰ درجه** می‌برد و همان‌جا نگه می‌دارد. سرووها ماشین‌های مدل را فرمان می‌دهند، بازوی ربات را حرکت می‌دهند و درهای کوچک را باز می‌کنند.

زاویه را با پالس‌هایی روی یک سیم سیگنال به آن می‌گویی: آردوینو ۵۰ بار در ثانیه یک پالس می‌فرستد؛ حدود **۰٫۵ میلی‌ثانیه** برای ۰ درجه تا **۲٫۵ میلی‌ثانیه** برای ۱۸۰ درجه. لازم نیست خودت این پالس‌ها را زمان‌بندی کنی: کتابخانهٔ **Servo** این کار را می‌کند و تو فقط می‌نویسی \`horn.write(90);\`.

در این پروژه سروو از ۰ تا ۱۸۰ درجه و برعکس جاروب می‌کند و پیشرفتش را در **مانیتور سریال** چاپ می‌کند. هر مرحله وقتی مدارت درست باشد خودش سبز می‌شود.`,
      },
    },
    {
      id: 'servo',
      title: { en: 'Add the servo', fa: 'سروو را اضافه کن' },
      body: {
        en: `Add an **SG90 micro servo**. It has three wires: **signal** (orange), **vcc** (red) and **gnd** (brown).

Connect **signal** to a digital pin, for example **D9**. The Servo library can use any digital pin, but it borrows a timer, which switches off PWM (\`analogWrite\`) on pins 9 and 10.`,
        fa: `یک **میکروسروو SG90** اضافه کن. سه سیم دارد: **signal** (نارنجی)، **vcc** (قرمز) و **gnd** (قهوه‌ای).

**signal** را به یک پایهٔ دیجیتال وصل کن، مثلاً **D9**. کتابخانهٔ Servo می‌تواند از هر پایهٔ دیجیتالی استفاده کند، اما یک تایمر را قرض می‌گیرد و با این کار PWM (\`analogWrite\`) روی پایه‌های 9 و 10 خاموش می‌شود.`,
      },
      checks: [
        { kind: 'part', type: SERVO },
        { kind: 'boardPin', pin: servo('signal'), pinKind: 'digital' },
      ],
    },
    {
      id: 'power',
      title: { en: 'Give the servo its own power', fa: 'به سروو برق جداگانه بده' },
      body: {
        en: `When a servo starts moving, or gets stuck, it can draw up to **650 mA**. The Uno’s **5V** pin can give only about 500 mA in total, so a servo on it can make the Arduino reset or overload. Give the servo its own supply: four AA cells (6 V) suit the SG90.

![The pack powers the servo; the Uno only sends the signal](asset:power)

Add a **4×AA battery pack** and connect:

- pack **pos** → servo **vcc**
- servo **gnd** → **GND** on the Uno
- pack **neg** → another **GND** on the Uno

Joining the grounds matters: the signal is measured against ground, so the servo and the Uno must share one.`,
        fa: `سروو وقتی شروع به حرکت می‌کند، یا گیر می‌کند، تا **۶۵۰ میلی‌آمپر** جریان می‌کشد. پایهٔ **5V** آردوینو روی هم فقط حدود ۵۰۰ میلی‌آمپر می‌دهد، پس سروو روی آن ممکن است آردوینو را ریست کند یا بیش از حد بارش بگذارد. به سروو منبع خودش را بده: چهار باتری قلمی (۶ ولت) برای SG90 مناسب است.

![جاباتری به سروو برق می‌دهد؛ آردوینو فقط سیگنال می‌فرستد](asset:power)

یک **جاباتری ۴ تایی قلمی** اضافه کن و وصل کن:

- **pos** جاباتری ← **vcc** سروو
- **gnd** سروو ← **GND** آردوینو
- **neg** جاباتری ← یک **GND** دیگر آردوینو

وصل کردن زمین‌ها به هم مهم است: سیگنال نسبت به زمین سنجیده می‌شود، پس سروو و آردوینو باید زمین مشترک داشته باشند.`,
      },
      checks: [
        { kind: 'part', type: PACK },
        { kind: 'connected', a: pack('pos'), b: servo('vcc') },
        { kind: 'boardPin', pin: servo('gnd'), pinKind: 'ground' },
        { kind: 'boardPin', pin: pack('neg'), pinKind: 'ground' },
      ],
      hints: {
        notOnBoard: {
          en: 'Both the servo’s gnd and the pack’s neg must go to GND pins on the Uno, so everything shares one ground.',
          fa: 'هم gnd سروو و هم neg جاباتری باید به پایه‌های GND آردوینو بروند تا همه زمین مشترک داشته باشند.',
        },
      },
    },
    {
      id: 'code',
      title: { en: 'Tell the sketch your pin', fa: 'پایه را به برنامه بگو' },
      body: {
        en: `Open the **Code** tab. Set \`SERVO_PIN\` to the pin the signal wire goes to, for example \`const int SERVO_PIN = 9;\`.

\`horn.attach(SERVO_PIN)\` starts the pulses on that pin. Then two \`for\` loops walk the angle up to 180 and back down again, one degree every \`STEP_MS\` milliseconds, printing every 45°. Try a smaller \`STEP_MS\` later for a faster sweep.`,
        fa: `زبانهٔ **کد** را باز کن. \`SERVO_PIN\` را پایه‌ای بگذار که سیم سیگنال به آن رفته، مثلاً \`const int SERVO_PIN = 9;\`.

\`horn.attach(SERVO_PIN)\` پالس‌ها را روی آن پایه شروع می‌کند. بعد دو حلقهٔ \`for\` زاویه را یکی‌یکی تا 180 بالا و دوباره پایین می‌برند، هر \`STEP_MS\` میلی‌ثانیه یک درجه، و هر ۴۵ درجه چاپ می‌کنند. بعداً \`STEP_MS\` کوچک‌تری را امتحان کن تا جاروب سریع‌تر شود.`,
      },
      checks: [{ kind: 'code', use: 'servo', at: servo('signal') }],
      solution: SERVO_SWEEP_PINS,
    },
    {
      id: 'run',
      title: { en: 'Watch it sweep', fa: 'جاروبش را تماشا کن' },
      body: {
        en: 'Press **Run** and open the **Serial Monitor**. The horn should swing all the way across and back while the monitor counts **Angle: 0 … 180 … 45**, then **Sweep 1 done**.',
        fa: '**اجرا** را بزن و **مانیتور سریال** را باز کن. بازو باید کامل از یک طرف به طرف دیگر برود و برگردد و مانیتور **Angle: 0 … 180 … 45** و بعد **Sweep 1 done** را نشان دهد.',
      },
      checks: [{ kind: 'run' }],
      hints: {
        notRun: {
          en: 'Run it and wait about 6 s for one full sweep. If the horn does not move, check SERVO_PIN and that the pack’s pos goes to the servo’s vcc with both grounds on GND.',
          fa: 'اجرا کن و حدود ۶ ثانیه برای یک جاروب کامل صبر کن. اگر بازو تکان نخورد، SERVO_PIN را بررسی کن و ببین pos جاباتری به vcc سروو رفته و هر دو زمین به GND وصل باشند.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [part('servo', SERVO, g(42), g(5)), part('pack', PACK, g(44), g(16))],
    [
      ['board.D9', 'servo.signal'],
      ['pack.pos', 'servo.vcc'],
      ['servo.gnd', 'board.GND1'],
      ['pack.neg', 'board.GND2'],
    ],
    SERVO_SWEEP_SOLUTION_SKETCH,
  ),
  assets: { power: POWER_SVG },
};
