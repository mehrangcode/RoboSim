import type { GuidedCheckInput } from '@robosim/shared';
import { benchBase } from './bench.js';
import { card, dot, led, resistor, uno, wire } from './bench-art.js';
import { finished, g, part } from './robot.js';
import {
  BLINK_TRAFFIC_LIGHT_PINS,
  BLINK_TRAFFIC_LIGHT_SOLUTION_SKETCH,
  BLINK_TRAFFIC_LIGHT_STARTER_SKETCH,
} from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'blink-traffic-light';
const VERSION = 1;
const LED = 'actuator.led';
const RES = 'passive.resistor';

const starter = benchBase(
  { slug: SLUG, version: VERSION },
  'Blink & Traffic Light',
  BLINK_TRAFFIC_LIGHT_STARTER_SKETCH,
  {
    id: 'traffic-light-cycle',
    // One full cycle: red, green, yellow and back to red.
    condition: {
      all: [
        { type: 'serialMatches', pattern: 'RED[\\s\\S]*GREEN[\\s\\S]*YELLOW[\\s\\S]*RED' },
        { type: 'timeLimit', seconds: 60 },
      ],
    },
  },
);

/** Pin → resistor → LED → GND, the circuit every LED in this project uses. */
const LED_CIRCUIT_SVG = card(
  300,
  130,
  uno(14, 23) +
    dot(118, 30) +
    wire('118,30 150,30 150,70 160,70', '#f1c40f') +
    resistor(190, 70) +
    wire('220,70 236,70 236,92', '#f1c40f') +
    led(240, 102, '#e53935') +
    wire('244,98 270,98 270,118 92,118 92,103', '#222') +
    dot(92, 103),
);

const TRAFFIC_COVER = card(
  320,
  180,
  uno(24, 48) +
    `<rect x="214" y="22" width="56" height="140" rx="12" fill="#37474f"/>` +
    [
      ['#e53935', 50, true],
      ['#fbc02d', 92, false],
      ['#43a047', 134, false],
    ]
      .map(
        ([c, y, on]) =>
          (on ? `<circle cx="242" cy="${y as number}" r="24" fill="${c as string}" opacity="0.3"/>` : '') +
          `<circle cx="242" cy="${y as number}" r="16" fill="${c as string}" opacity="${on ? 1 : 0.35}"/>`,
      )
      .join('') +
    wire('136,60 176,60 176,50 226,50', '#f1c40f') +
    wire('136,76 186,76 186,92 226,92', '#f1c40f') +
    wire('136,92 196,92 196,134 226,134', '#f1c40f'),
);

const led3 = (pin: 'a' | 'k') => ({ type: LED, pin });
const res = (pin: 'a' | 'b') => ({ type: RES, pin });

/** The wiring checks one LED needs; with three LEDs of one type they pass once any LED is wired right. */
const LED_WIRING: GuidedCheckInput[] = [
  { kind: 'boardPin', pin: res('a'), pinKind: 'digital' },
  { kind: 'connected', a: res('b'), b: led3('a') },
  { kind: 'boardPin', pin: led3('k'), pinKind: 'ground' },
];

export const blinkTrafficLight: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: true,
  minutes: 20,
  arenaId: null,
  cover: TRAFFIC_COVER,
  title: { en: 'Blink & Traffic Light', fa: 'چشمک‌زن و چراغ راهنمایی' },
  summary: {
    en: 'Your first circuit: light LEDs safely through resistors and switch them with digitalWrite and delay to run a red–green–yellow traffic light.',
    fa: 'اولین مدارت: LEDها را با مقاومت، بی‌خطر روشن کن و با digitalWrite و delay یک چراغ راهنمایی قرمز–سبز–زرد بساز.',
  },
  steps: [
    {
      id: 'intro',
      title: { en: 'Blink: the “hello world” of Arduino', fa: 'چشمک‌زن: «سلام دنیا»ی آردوینو' },
      body: {
        en: `Every Arduino sketch has two parts: \`setup()\` runs once when the board starts, and \`loop()\` runs again and again forever.

The classic first sketch, **Blink**, flashes the LED that is built into the Uno on pin **13**:

- in \`setup()\`: \`pinMode(13, OUTPUT);\` lets the pin drive something
- in \`loop()\`: \`digitalWrite(13, HIGH);\` puts 5 V on the pin: LED on
- then \`delay(500);\` waits 500 milliseconds (half a second)
- then \`digitalWrite(13, LOW);\` puts 0 V on it: LED off, and \`delay(500);\` again

In this project you use exactly these three ideas to build a **traffic light** with a red, a yellow and a green LED. Each step turns green by itself when your circuit is right.`,
        fa: `هر برنامهٔ آردوینو دو بخش دارد: \`setup()\` یک بار وقتی برد روشن می‌شود اجرا می‌شود و \`loop()\` بارها و بارها، تا ابد، تکرار می‌شود.

اولین برنامهٔ معروف، **Blink**، LED داخلی Uno روی پایهٔ **13** را چشمک می‌زند:

- در \`setup()\`: \`pinMode(13, OUTPUT);\` پایه را آمادهٔ راه‌انداختن چیزی می‌کند
- در \`loop()\`: \`digitalWrite(13, HIGH);\` روی پایه ۵ ولت می‌گذارد: LED روشن
- بعد \`delay(500);\` پانصد میلی‌ثانیه (نیم ثانیه) صبر می‌کند
- بعد \`digitalWrite(13, LOW);\` صفر ولت می‌گذارد: LED خاموش، و دوباره \`delay(500);\`

در این پروژه با همین سه ایده یک **چراغ راهنمایی** با LED قرمز، زرد و سبز می‌سازی. هر مرحله وقتی مدارت درست باشد خودش سبز می‌شود.`,
      },
    },
    {
      id: 'first-led',
      title: { en: 'Wire one LED through a resistor', fa: 'یک LED را با مقاومت وصل کن' },
      body: {
        en: `An LED lets current through in one direction only and has almost no resistance of its own. Straight on a 5 V pin it would draw far too much current and burn out (and could damage the pin). A **resistor** in series limits the current: with **220 Ω**, about (5 V − 2 V) / 220 Ω ≈ 14 mA flows, bright and safe.

![Pin, resistor, LED, ground](asset:circuit)

From the **parts library** add a **resistor** (220 Ω is the default) and an **LED**, then draw wires:

- a digital pin, for example **D4** → the resistor’s end **a**
- the resistor’s end **b** → the LED’s **a** (anode, the long leg)
- the LED’s **k** (cathode, the short leg) → **GND**`,
        fa: `LED جریان را فقط در یک جهت عبور می‌دهد و خودش تقریباً هیچ مقاومتی ندارد. اگر مستقیم به پایهٔ ۵ ولت وصلش کنی، جریان خیلی زیادی می‌کشد و می‌سوزد (و ممکن است به پایه هم آسیب بزند). یک **مقاومت** سری جریان را محدود می‌کند: با **۲۲۰ اهم** حدود (۵ − ۲) ÷ ۲۲۰ ≈ ۱۴ میلی‌آمپر جریان می‌گذرد؛ هم روشن، هم بی‌خطر.

![پایه، مقاومت، LED، زمین](asset:circuit)

از **کتابخانهٔ قطعات** یک **مقاومت** (پیش‌فرض ۲۲۰ اهم است) و یک **LED** اضافه کن و سیم بکش:

- یک پایهٔ دیجیتال، مثلاً **D4** ← سر **a** مقاومت
- سر **b** مقاومت ← پایهٔ **a** (آند، پایهٔ بلندتر) LED
- پایهٔ **k** (کاتد، پایهٔ کوتاه‌تر) LED ← **GND**`,
      },
      checks: [{ kind: 'part', type: RES }, { kind: 'part', type: LED }, ...LED_WIRING],
      hints: {
        notConnected: {
          en: 'Wire the resistor’s end b to the LED’s a (anode, the long leg).',
          fa: 'سر b مقاومت را به پایهٔ a (آند، پایهٔ بلندتر) LED وصل کن.',
        },
      },
    },
    {
      id: 'three-leds',
      title: { en: 'Red, yellow and green', fa: 'قرمز، زرد و سبز' },
      body: {
        en: `A traffic light needs three lights. Your first LED is **red** (the default **color**). Add two more LEDs, each with **its own resistor**, and set their **color** in the **Properties** panel to **yellow** and **green**. Wire them the same way to two other digital pins, for example **D3** and **D2**.

Why not share one resistor? Each LED needs its own current limit, otherwise the LEDs that are on at the same time would share the current unevenly.`,
        fa: `چراغ راهنمایی سه چراغ لازم دارد. LED اولت **قرمز** است (**رنگ** پیش‌فرض). دو LED دیگر، هر کدام با **مقاومت جداگانهٔ خودش**، اضافه کن و در پنل **ویژگی‌ها** رنگشان را **زرد** و **سبز** کن. بعد آن‌ها را به همان شکل به دو پایهٔ دیجیتال دیگر وصل کن، مثلاً **D3** و **D2**.

چرا یک مقاومت مشترک نه؟ هر LED محدودکنندهٔ جریان خودش را لازم دارد، وگرنه LEDهایی که هم‌زمان روشن‌اند جریان را نابرابر بین خودشان تقسیم می‌کنند.`,
      },
      checks: [
        { kind: 'part', type: LED, count: 3 },
        { kind: 'part', type: RES, count: 3 },
        { kind: 'prop', type: LED, prop: 'color', equals: 'red' },
        { kind: 'prop', type: LED, prop: 'color', equals: 'yellow' },
        { kind: 'prop', type: LED, prop: 'color', equals: 'green' },
        ...LED_WIRING,
      ],
      hints: {
        propMismatch: {
          en: 'Select an LED and pick its color in the Properties panel: you need one red, one yellow and one green.',
          fa: 'یک LED را انتخاب کن و رنگش را در پنل ویژگی‌ها تعیین کن: یکی قرمز، یکی زرد و یکی سبز لازم داری.',
        },
      },
    },
    {
      id: 'code',
      title: { en: 'Tell the sketch your pins', fa: 'پایه‌ها را به برنامه بگو' },
      body: {
        en: `Open the **Code** tab. The sketch already runs the traffic light, but every pin number is **0**. Replace each 0 with the pin that LED’s resistor is wired to, for example \`const int RED = 4;\`.

The \`phase()\` function switches each LED with \`digitalWrite\`, prints the phase’s name on the **Serial Monitor**, then holds it with \`delay\`: red 4 s, green 4 s, yellow 1.5 s, and round again.`,
        fa: `زبانهٔ **کد** را باز کن. برنامه از قبل چراغ راهنمایی را اجرا می‌کند، اما شمارهٔ همهٔ پایه‌ها **0** است. هر 0 را با پایه‌ای که مقاومت آن LED به آن وصل است عوض کن، مثلاً \`const int RED = 4;\`.

تابع \`phase()\` هر LED را با \`digitalWrite\` روشن یا خاموش می‌کند، نام آن مرحله را در **مانیتور سریال** چاپ می‌کند و بعد با \`delay\` نگهش می‌دارد: قرمز ۴ ثانیه، سبز ۴ ثانیه، زرد ۱٫۵ ثانیه و دوباره از اول.`,
      },
      checks: [
        { kind: 'code', use: 'pinMode', at: res('a') },
        { kind: 'code', use: 'digitalWrite', at: res('a') },
      ],
      solution: BLINK_TRAFFIC_LIGHT_PINS,
    },
    {
      id: 'run',
      title: { en: 'Run the traffic light', fa: 'چراغ راهنمایی را اجرا کن' },
      body: {
        en: 'Press **Run** and open the **Serial Monitor**. The lights should go red → green → yellow → red, and each phase’s name should appear as it starts. Once a full cycle has run, this step turns green.',
        fa: '**اجرا** را بزن و **مانیتور سریال** را باز کن. چراغ‌ها باید به ترتیب قرمز ← سبز ← زرد ← قرمز روشن شوند و نام هر مرحله هم‌زمان با شروعش چاپ شود. وقتی یک دور کامل اجرا شد، این مرحله سبز می‌شود.',
      },
      checks: [{ kind: 'run' }],
      hints: {
        notRun: {
          en: 'Press Run and wait for one full cycle (about 10 s). If a light stays dark, check that LED’s pin number in the sketch and that its long leg (a) goes to the resistor.',
          fa: 'اجرا را بزن و یک دور کامل (حدود ۱۰ ثانیه) صبر کن. اگر چراغی روشن نشد، شمارهٔ پایهٔ آن LED در برنامه را بررسی کن و ببین پایهٔ بلندش (a) به مقاومت وصل باشد.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [
      part('rRed', RES, g(32), g(4), { props: { ohms: 220 } }),
      part('red', LED, g(39), g(4), { props: { color: 'red' } }),
      part('rYellow', RES, g(32), g(9), { props: { ohms: 220 } }),
      part('yellow', LED, g(39), g(9), { props: { color: 'yellow' } }),
      part('rGreen', RES, g(32), g(14), { props: { ohms: 220 } }),
      part('green', LED, g(39), g(14), { props: { color: 'green' } }),
    ],
    [
      ['board.D4', 'rRed.a'],
      ['rRed.b', 'red.a'],
      ['red.k', 'board.GND1'],
      ['board.D3', 'rYellow.a'],
      ['rYellow.b', 'yellow.a'],
      ['yellow.k', 'board.GND2'],
      ['board.D2', 'rGreen.a'],
      ['rGreen.b', 'green.a'],
      ['green.k', 'board.GND3'],
    ],
    BLINK_TRAFFIC_LIGHT_SOLUTION_SKETCH,
  ),
  assets: { circuit: LED_CIRCUIT_SVG },
};
