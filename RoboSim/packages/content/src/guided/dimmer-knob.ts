import { benchBase } from './bench.js';
import { card, dot, led, resistor, uno, wire } from './bench-art.js';
import { finished, g, part } from './robot.js';
import { DIMMER_KNOB_PINS, DIMMER_KNOB_SOLUTION_SKETCH, DIMMER_KNOB_STARTER_SKETCH } from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'dimmer-knob';
const VERSION = 1;
const POT = 'passive.potentiometer';
const LED = 'actuator.led';
const RES = 'passive.resistor';
const pot = (pin: string) => ({ type: POT, pin });

// The knob turned all the way both ways: fully off and fully bright prove the 0..1023 → 0..255 mapping.
const starter = benchBase({ slug: SLUG, version: VERSION }, 'Dimmer Knob', DIMMER_KNOB_STARTER_SKETCH, {
  id: 'full-range',
  condition: {
    all: [
      { type: 'serialMatches', pattern: 'Brightness: 0\\b' },
      { type: 'serialMatches', pattern: 'Brightness: 255\\b' },
    ],
  },
});

/** A rotary potentiometer from above with its three legs below. */
const knob = (x: number, y: number, angle: number): string =>
  `<g transform="translate(${x} ${y})">` +
  `<rect x="-26" y="-26" width="52" height="40" rx="4" fill="#1565c0"/>` +
  `<circle cx="0" cy="-8" r="16" fill="#cfd8dc" stroke="#78909c" stroke-width="2"/>` +
  `<path d="M0 -8 l${(13 * Math.sin((angle * Math.PI) / 180)).toFixed(1)} ${(-13 * Math.cos((angle * Math.PI) / 180)).toFixed(1)}" stroke="#263238" stroke-width="3" stroke-linecap="round"/>` +
  [-16, 0, 16].map((dx) => `<path d="M${dx} 14 v12" stroke="#9e9e9e" stroke-width="3"/>`).join('') +
  `</g>`;

/** 5 V on one end, GND on the other: the middle pin picks a voltage in between. */
const DIVIDER_SVG = card(
  280,
  130,
  knob(140, 56, -60) +
    wire('124,82 124,108 40,108', '#e53935') +
    wire('156,82 156,108 240,108', '#222') +
    wire('140,82 140,120', '#f1c40f') +
    dot(40, 108, '#e53935') +
    dot(240, 108) +
    dot(140, 120, '#f1c40f'),
);

/** PWM: the same 5 V pulses, on for a longer or shorter share of each period. */
const PWM_DUTY_SVG = card(
  300,
  130,
  [
    [20, 0.2],
    [70, 0.8],
  ]
    .map(
      ([y, duty]) =>
        `<path d="${Array.from({ length: 4 }, (_, i) => {
          const x = 20 + i * 50;
          const on = 50 * (duty as number);
          return `M${x} ${(y as number) + 40} V${y as number} h${on} V${(y as number) + 40} h${50 - on}`;
        }).join(' ')}" stroke="#1e88e5" stroke-width="3" fill="none"/>`,
    )
    .join('') +
    led(255, 58, '#fbc02d', false) +
    led(255, 112, '#fbc02d', true),
);

const DIMMER_COVER = card(
  320,
  180,
  uno(20, 48) +
    knob(180, 120, 50) +
    resistor(220, 50) +
    led(270, 72, '#fbc02d') +
    wire('132,68 160,68 160,50 190,50', '#f1c40f') +
    wire('132,112 150,112 150,160 180,160 180,146', '#f1c40f'),
);

export const dimmerKnob: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: true,
  minutes: 25,
  arenaId: null,
  cover: DIMMER_COVER,
  title: { en: 'Dimmer Knob', fa: 'دیمر با پیچ' },
  summary: {
    en: 'Turn a knob to dim an LED: read a potentiometer with analogRead, scale it with map and set the brightness with PWM through analogWrite.',
    fa: 'با چرخاندن یک پیچ، نور LED را کم و زیاد کن: پتانسیومتر را با analogRead بخوان، با map مقیاسش را عوض کن و با PWM و analogWrite روشنایی را تنظیم کن.',
  },
  steps: [
    {
      id: 'intro',
      title: { en: 'From a knob to a brightness', fa: 'از پیچ تا روشنایی' },
      body: {
        en: `Digital pins know only two levels, 0 V and 5 V. In this project you use the Uno’s **in-between** abilities:

- **analogRead** measures a voltage between 0 and 5 V on pins **A0–A5** and gives a number from **0 to 1023**.
- **analogWrite** on a **PWM** pin (marked **~**) dims an LED by giving it a brightness from **0 to 255**.
- **map** converts one range into the other.

You will wire a **potentiometer** (a knob) and an LED, then watch the brightness follow the knob, with the numbers on the **Serial Monitor**. Each step turns green by itself when your circuit is right.`,
        fa: `پایه‌های دیجیتال فقط دو سطح می‌شناسند: صفر و ۵ ولت. در این پروژه از توانایی‌های **میانی** Uno استفاده می‌کنی:

- **analogRead** ولتاژی بین صفر تا ۵ ولت را روی پایه‌های **A0 تا A5** اندازه می‌گیرد و عددی از **0 تا 1023** می‌دهد.
- **analogWrite** روی یک پایهٔ **PWM** (با علامت **~**) با دادن روشنایی از **0 تا 255** نور LED را کم و زیاد می‌کند.
- **map** یک بازه را به بازهٔ دیگر تبدیل می‌کند.

یک **پتانسیومتر** (پیچ) و یک LED را سیم‌کشی می‌کنی و می‌بینی روشنایی دنبال پیچ می‌رود؛ عددها هم در **مانیتور سریال** می‌آیند. هر مرحله وقتی مدارت درست باشد خودش سبز می‌شود.`,
      },
    },
    {
      id: 'knob',
      title: { en: 'Wire the knob', fa: 'پیچ را سیم‌کشی کن' },
      body: {
        en: `A **potentiometer** is a resistor with a sliding contact. Put 5 V on one end and 0 V on the other, and the middle pin (the **wiper**) gives any voltage in between as you turn it.

![5 V and GND on the ends, the wiper in the middle](asset:divider)

Add a **potentiometer** and connect:

- **a** → **5V**
- **wiper** → an analog pin, for example **A0**
- **b** → **GND**`,
        fa: `**پتانسیومتر** یک مقاومت با یک کنتاکت لغزان است. اگر به یک سرش ۵ ولت و به سر دیگرش صفر ولت بدهی، پایهٔ وسط (**wiper**) با چرخاندن پیچ هر ولتاژی بین این دو را می‌دهد.

![۵ ولت و GND روی دو سر، wiper در وسط](asset:divider)

یک **پتانسیومتر** اضافه کن و وصل کن:

- **a** ← **5V**
- **wiper** ← یک پایهٔ آنالوگ، مثلاً **A0**
- **b** ← **GND**`,
      },
      checks: [
        { kind: 'part', type: POT },
        { kind: 'boardPin', pin: pot('a'), pinKind: '5v' },
        { kind: 'boardPin', pin: pot('wiper'), pinKind: 'analog' },
        { kind: 'boardPin', pin: pot('b'), pinKind: 'ground' },
      ],
    },
    {
      id: 'led',
      title: { en: 'Add the LED on a PWM pin', fa: 'LED را روی یک پایهٔ PWM بگذار' },
      body: {
        en: `A pin cannot really give 2.5 V. Instead, **PWM** switches it on and off about 500 times a second; the longer the “on” share, the brighter the LED looks. Only the pins marked **~** can do this: **3, 5, 6, 9, 10, 11**.

![Short pulses: dim. Long pulses: bright.](asset:pwm)

Add a **resistor** and an **LED** and wire them like a traffic-light LED, but to a **PWM** pin:

- a PWM pin, for example **D9** → resistor **a**
- resistor **b** → LED **a** (the long leg)
- LED **k** → **GND**`,
        fa: `یک پایه واقعاً نمی‌تواند ۲٫۵ ولت بدهد. به جایش **PWM** آن را حدود ۵۰۰ بار در ثانیه روشن و خاموش می‌کند؛ هرچه سهم «روشن» بیشتر باشد، LED پرنورتر به نظر می‌رسد. فقط پایه‌های با علامت **~** این کار را می‌کنند: **3، 5، 6، 9، 10، 11**.

![پالس‌های کوتاه: کم‌نور. پالس‌های بلند: پرنور.](asset:pwm)

یک **مقاومت** و یک **LED** اضافه کن و مثل LEDهای چراغ راهنمایی وصلشان کن، اما به یک پایهٔ **PWM**:

- یک پایهٔ PWM، مثلاً **D9** ← سر **a** مقاومت
- سر **b** مقاومت ← پایهٔ **a** (پایهٔ بلندتر) LED
- پایهٔ **k** LED ← **GND**`,
      },
      checks: [
        { kind: 'part', type: RES },
        { kind: 'part', type: LED },
        { kind: 'boardPin', pin: { type: RES, pin: 'a' }, pinKind: 'pwm' },
        { kind: 'connected', a: { type: RES, pin: 'b' }, b: { type: LED, pin: 'a' } },
        { kind: 'boardPin', pin: { type: LED, pin: 'k' }, pinKind: 'ground' },
      ],
      hints: {
        wrongPinKind: {
          en: 'The resistor’s end a must go to a PWM pin (3, 5, 6, 9, 10 or 11) and the LED’s k to GND.',
          fa: 'سر a مقاومت باید به یک پایهٔ PWM (3، 5، 6، 9، 10 یا 11) و پایهٔ k LED به GND برود.',
        },
      },
    },
    {
      id: 'code',
      title: { en: 'Tell the sketch your pins', fa: 'پایه‌ها را به برنامه بگو' },
      body: {
        en: `Open the **Code** tab. Set \`KNOB\` to the analog pin of the wiper (for example \`A0\`) and \`LED\` to the PWM pin of the resistor (for example \`9\`). Always write analog pins with their **A** name: \`A0\` is pin 14 on the Uno, while a plain \`0\` means digital pin D0.

\`map(knob, 0, 1023, 0, 255)\` scales the reading: 0 stays 0, 1023 becomes 255 and 512 becomes about 127. Four times a second the sketch prints both numbers so you can see the mapping.`,
        fa: `زبانهٔ **کد** را باز کن. \`KNOB\` را پایهٔ آنالوگ wiper (مثلاً \`A0\`) و \`LED\` را پایهٔ PWM مقاومت (مثلاً \`9\`) بگذار. پایه‌های آنالوگ را همیشه با نام **A** بنویس: \`A0\` روی Uno پایهٔ ۱۴ است، اما یک \`0\` تنها یعنی پایهٔ دیجیتال D0.

\`map(knob, 0, 1023, 0, 255)\` مقیاس خواندن را عوض می‌کند: 0 همان 0 می‌ماند، 1023 می‌شود 255 و 512 حدوداً 127. برنامه چهار بار در ثانیه هر دو عدد را چاپ می‌کند تا تبدیل را ببینی.`,
      },
      checks: [
        { kind: 'code', use: 'pinMode', at: pot('wiper') },
        { kind: 'code', use: 'analogRead', at: pot('wiper') },
        { kind: 'code', use: 'analogWrite', at: { type: RES, pin: 'a' } },
      ],
      solution: DIMMER_KNOB_PINS,
    },
    {
      id: 'run',
      title: { en: 'Turn the knob all the way', fa: 'پیچ را تا ته بچرخان' },
      body: {
        en: 'Press **Run** and open the **Serial Monitor**. Turn the knob fully one way, then fully the other way: the LED should go from off to full brightness and the monitor should show **Brightness: 0** and **Brightness: 255**.',
        fa: '**اجرا** را بزن و **مانیتور سریال** را باز کن. پیچ را تا ته به یک طرف و بعد تا ته به طرف دیگر بچرخان: LED باید از خاموش تا حداکثر نور برود و مانیتور **Brightness: 0** و **Brightness: 255** را نشان دهد.',
      },
      checks: [{ kind: 'run' }],
      hints: {
        notRun: {
          en: 'While it runs, drag the knob to both ends (0 and 255 must both appear). If the number never changes, check KNOB; if the LED stays dark, check LED is a ~ pin.',
          fa: 'در حین اجرا پیچ را تا هر دو سر بکش (هم 0 و هم 255 باید بیایند). اگر عدد عوض نمی‌شود KNOB را بررسی کن؛ اگر LED خاموش می‌ماند، ببین LED روی یک پایهٔ ~ باشد.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [
      part('pot', POT, g(32), g(18)),
      part('r1', RES, g(32), g(5), { props: { ohms: 220 } }),
      part('led', LED, g(39), g(5), { props: { color: 'yellow' } }),
    ],
    [
      ['board.5V', 'pot.a'],
      ['pot.wiper', 'board.A0'],
      ['pot.b', 'board.GND2'],
      ['board.D9', 'r1.a'],
      ['r1.b', 'led.a'],
      ['led.k', 'board.GND1'],
    ],
    DIMMER_KNOB_SOLUTION_SKETCH,
  ),
  referenceInputs: [
    { slice: 500, componentId: 'pot', name: 'position', value: 0 },
    { slice: 1500, componentId: 'pot', name: 'position', value: 1 },
  ],
  assets: { divider: DIVIDER_SVG, pwm: PWM_DUTY_SVG },
};
