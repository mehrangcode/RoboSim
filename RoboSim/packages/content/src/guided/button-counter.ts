import { benchBase } from './bench.js';
import { card, dot, uno, wire } from './bench-art.js';
import { finished, g, part } from './robot.js';
import {
  BUTTON_COUNTER_PINS,
  BUTTON_COUNTER_SOLUTION_SKETCH,
  BUTTON_COUNTER_STARTER_SKETCH,
} from './sketches.js';
import type { GuidedContent, GuidedInput } from './types.js';

const SLUG = 'button-counter';
const VERSION = 1;
const BTN = 'sensor.push-button';
const btn = (pin: string) => ({ type: BTN, pin });

const starter = benchBase({ slug: SLUG, version: VERSION }, 'Button Counter', BUTTON_COUNTER_STARTER_SKETCH, {
  id: 'count-three',
  condition: { type: 'serialMatches', pattern: 'Count: 3\\b' },
});

/** A tactile button seen from above: legs a1/a2 joined on one side, b1/b2 on the other. */
const button = (x: number, y: number, pressed = false): string =>
  `<g transform="translate(${x} ${y})">` +
  `<rect x="0" y="0" width="60" height="60" rx="4" fill="#37474f"/>` +
  `<circle cx="30" cy="30" r="17" fill="${pressed ? '#c62828' : '#e53935'}"/>` +
  [
    [-8, 8],
    [-8, 52],
    [68, 8],
    [68, 52],
  ]
    .map(
      ([lx, ly]) =>
        `<rect x="${(lx as number) - 4}" y="${(ly as number) - 3}" width="8" height="6" fill="#9e9e9e"/>`,
    )
    .join('') +
  `</g>`;

/** Legs: the a pair is joined, the b pair is joined; pressing joins a to b. */
const LEGS_SVG = card(
  260,
  140,
  button(100, 40) +
    wire('92,48 76,48 76,92 92,92', '#43a047') +
    wire('168,48 184,48 184,92 168,92', '#1e88e5') +
    `<path d="M128 22 v14 M122 30 l6 6 l6 -6" stroke="#555" stroke-width="2.5" fill="none"/>`,
);

const BUTTON_COVER = card(
  320,
  180,
  uno(24, 48) +
    button(200, 70, true) +
    dot(136, 60) +
    wire('136,60 176,60 176,78 192,78', '#f1c40f') +
    wire('136,120 176,120 176,122 192,122', '#222') +
    [0, 1, 2]
      .map(
        (i) =>
          `<rect x="${206 + i * 18}" y="${30 + (i === 2 ? -4 : 0)}" width="12" height="${16 + i * 4}" rx="2" fill="#1e88e5" opacity="${0.5 + i * 0.25}"/>`,
      )
      .join(''),
);

/** Three clicks, 300 ms down and 400 ms apart, like a learner pressing the button while it runs. */
const PRESSES: GuidedInput[] = [1000, 1700, 2400].flatMap((at) => [
  { slice: at, componentId: 'btn', name: 'pressed', value: true },
  { slice: at + 300, componentId: 'btn', name: 'pressed', value: false },
]);

export const buttonCounter: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: true,
  minutes: 20,
  arenaId: null,
  cover: BUTTON_COVER,
  title: { en: 'Button Counter', fa: 'شمارندهٔ دکمه' },
  summary: {
    en: 'Read a push button with the built-in pull-up, count each press exactly once with edge detection and debouncing, and print the total on the Serial Monitor.',
    fa: 'یک دکمهٔ فشاری را با مقاومت بالاکش داخلی بخوان، هر فشار را با تشخیص لبه و حذف لرزش دقیقاً یک بار بشمار و مجموع را در مانیتور سریال چاپ کن.',
  },
  steps: [
    {
      id: 'intro',
      title: { en: 'Count every press', fa: 'هر فشار را بشمار' },
      body: {
        en: `In this project the Arduino **listens**: you wire a push button to a pin and count how many times it is pressed, printing the total on the **Serial Monitor**.

It sounds simple, but there are two traps:

- \`loop()\` runs thousands of times a second, so while you hold the button it sees “pressed” thousands of times. You count only the moment it **changes** from released to pressed: an **edge**.
- Metal contacts **bounce**: for a few milliseconds a real button flickers between on and off. The sketch waits until the reading has been steady for 30 ms before it believes it: **debouncing**.

Each step turns green by itself when your circuit is right.`,
        fa: `در این پروژه آردوینو **گوش می‌دهد**: یک دکمهٔ فشاری را به یک پایه وصل می‌کنی، می‌شماری چند بار فشار داده شده و مجموع را در **مانیتور سریال** چاپ می‌کنی.

ساده به نظر می‌رسد، اما دو دام دارد:

- \`loop()\` هزاران بار در ثانیه اجرا می‌شود، پس تا وقتی دکمه را نگه داشته‌ای، هزاران بار «فشرده» می‌بیند. فقط لحظه‌ای را می‌شماری که از رها به فشرده **تغییر** می‌کند: یک **لبه**.
- کنتاکت‌های فلزی **می‌لرزند**: یک دکمهٔ واقعی چند میلی‌ثانیه بین وصل و قطع می‌پرد. برنامه صبر می‌کند تا خواندن ۳۰ میلی‌ثانیه ثابت بماند و بعد باورش می‌کند: **حذف لرزش** (debounce).

هر مرحله وقتی مدارت درست باشد خودش سبز می‌شود.`,
      },
    },
    {
      id: 'button',
      title: { en: 'Add a push button', fa: 'یک دکمهٔ فشاری اضافه کن' },
      body: {
        en: `Add a **push button** from the parts library. It has four legs in two pairs: **a1–a2** are always joined inside, and so are **b1–b2**. Pressing the button joins the **a** side to the **b** side.

![The button’s legs: each pair is joined; pressing joins the pairs](asset:legs)

So to switch something, use one **a** leg and one **b** leg. Wiring both legs of one side is a classic mistake: that “switch” is always closed.`,
        fa: `از کتابخانهٔ قطعات یک **دکمهٔ فشاری** اضافه کن. چهار پایه در دو جفت دارد: **a1–a2** همیشه از داخل به هم وصل‌اند و **b1–b2** هم همین‌طور. فشار دادن دکمه طرف **a** را به طرف **b** وصل می‌کند.

![پایه‌های دکمه: هر جفت به هم وصل است؛ فشار دادن دو جفت را به هم وصل می‌کند](asset:legs)

پس برای قطع و وصل، یک پایه از **a** و یک پایه از **b** را استفاده کن. سیم‌کشی هر دو پایهٔ یک طرف اشتباهی معروف است: آن «کلید» همیشه وصل است.`,
      },
      checks: [{ kind: 'part', type: BTN }],
    },
    {
      id: 'wiring',
      title: { en: 'Wire it with the built-in pull-up', fa: 'با بالاکش داخلی سیم‌کشی کن' },
      body: {
        en: `Connect the button between a digital pin and ground:

- **b1** → a digital pin, for example **D2**
- **a1** → **GND**

When the button is released the pin is connected to nothing and would “float”, reading random values. \`pinMode(BUTTON, INPUT_PULLUP)\` switches on a resistor inside the Arduino that gently pulls the pin up to 5 V. So the pin reads **HIGH when released** and **LOW when pressed** (the button connects it to GND). No extra resistor needed!`,
        fa: `دکمه را بین یک پایهٔ دیجیتال و زمین وصل کن:

- **b1** ← یک پایهٔ دیجیتال، مثلاً **D2**
- **a1** ← **GND**

وقتی دکمه رها است، پایه به هیچ‌جا وصل نیست و «معلق» می‌ماند و مقدارهای تصادفی می‌خواند. \`pinMode(BUTTON, INPUT_PULLUP)\` یک مقاومت داخل آردوینو را روشن می‌کند که پایه را آرام به ۵ ولت می‌کشد. پس پایه **وقتی رها است HIGH** و **وقتی فشرده است LOW** می‌خواند (دکمه آن را به GND وصل می‌کند). مقاومت اضافه لازم نیست!`,
      },
      checks: [
        { kind: 'boardPin', pin: btn('b1'), pinKind: 'digital' },
        { kind: 'boardPin', pin: btn('a1'), pinKind: 'ground' },
      ],
      hints: {
        wrongPinKind: {
          en: 'Leg b1 goes to a digital pin (D2–D13) and leg a1 to a GND pin.',
          fa: 'پایهٔ b1 به یک پایهٔ دیجیتال (D2 تا D13) و پایهٔ a1 به یکی از پایه‌های GND وصل می‌شود.',
        },
      },
    },
    {
      id: 'code',
      title: { en: 'Tell the sketch your pin', fa: 'پایه را به برنامه بگو' },
      body: {
        en: `Open the **Code** tab. The sketch already counts presses, but the button’s pin number is **0**. Replace it with the pin **b1** is wired to, for example \`const int BUTTON = 2;\`.

Read \`loop()\`: when the reading changes it notes the time; once it has stayed the same for \`DEBOUNCE_MS\` it becomes the new \`state\`, and a change to **LOW** is one new press. The built-in LED on pin 13 lights while the button is down.`,
        fa: `زبانهٔ **کد** را باز کن. برنامه از قبل فشارها را می‌شمارد، اما شمارهٔ پایهٔ دکمه **0** است. آن را با پایه‌ای که **b1** به آن وصل است عوض کن، مثلاً \`const int BUTTON = 2;\`.

\`loop()\` را بخوان: وقتی خواندن عوض می‌شود زمان را یادداشت می‌کند؛ وقتی به اندازهٔ \`DEBOUNCE_MS\` ثابت ماند، \`state\` جدید می‌شود و تغییر به **LOW** یعنی یک فشار تازه. LED داخلی روی پایهٔ 13 تا وقتی دکمه پایین است روشن می‌ماند.`,
      },
      checks: [
        { kind: 'code', use: 'pinMode', at: btn('b1') },
        { kind: 'code', use: 'digitalRead', at: btn('b1') },
      ],
      solution: BUTTON_COUNTER_PINS,
    },
    {
      id: 'run',
      title: { en: 'Press it three times', fa: 'سه بار فشارش بده' },
      body: {
        en: 'Press **Run** and open the **Serial Monitor**. Click the button on the canvas three times: you should see **Count: 1**, **Count: 2**, **Count: 3**, exactly one line per press however long you hold it.',
        fa: '**اجرا** را بزن و **مانیتور سریال** را باز کن. سه بار روی دکمه در صفحه کلیک کن: باید **Count: 1**، **Count: 2** و **Count: 3** را ببینی؛ برای هر فشار دقیقاً یک خط، هر چقدر هم نگهش داری.',
      },
      checks: [{ kind: 'run' }],
      hints: {
        notRun: {
          en: 'Run the project and click the button three times while it runs. If nothing counts, check that BUTTON matches the pin b1 is wired to and that a1 goes to GND.',
          fa: 'پروژه را اجرا کن و در حین اجرا سه بار روی دکمه کلیک کن. اگر چیزی شمرده نشد، ببین BUTTON با پایه‌ای که b1 به آن وصل است یکی باشد و a1 به GND رفته باشد.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [part('btn', BTN, g(32), g(10))],
    [
      ['btn.b1', 'board.D2'],
      ['btn.a1', 'board.GND1'],
    ],
    BUTTON_COUNTER_SOLUTION_SKETCH,
  ),
  referenceInputs: PRESSES,
  assets: { legs: LEGS_SVG },
};
