import type { GuidedCheckInput } from '@robosim/shared';
import { wideGapsArena, wideGapsChallenge } from '../arenas/line-tracks.js';
import { BASE_SVG, LINE_SENSOR_SVG, PWM_SVG } from './assets.js';
import { DRIVE_CODE_CHECKS, DRIVE_STEPS, introStep } from './drive-steps.js';
import { DRIVE_PARTS, DRIVE_WIRES, finished, g, part, robotBase, slot } from './robot.js';
import { MIND_THE_GAP_PINS, MIND_THE_GAP_SOLUTION_SKETCH, MIND_THE_GAP_STARTER_SKETCH } from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'mind-the-gap';
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
  `<rect x="30" y="25" width="260" height="130" rx="65" fill="none" stroke="#222" stroke-width="12"/>` +
    [
      [44, 44],
      [276, 44],
      [44, 136],
      [276, 136],
    ]
      .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="13" fill="#f5f2ea"/>`)
      .join('') +
    bot(150, 155, 0, 0.55),
);

/** Crossing a gap on a bend: the line stops, the robot keeps curving from memory and picks it up again. */
const GAP_SVG = svg(
  300,
  150,
  `<path d="M40 140 A110 110 0 0 1 95 45" stroke="#222" stroke-width="14" fill="none"/>` +
    `<path d="M205 45 A110 110 0 0 1 260 140" stroke="#222" stroke-width="14" fill="none"/>` +
    `<path d="M95 45 A110 110 0 0 1 205 45" stroke="#2e7d32" stroke-width="3" fill="none" stroke-dasharray="6 5"/>` +
    bot(88, 52, -60, 0.6) +
    `<circle cx="150" cy="100" r="14" fill="none" stroke="#1f6fa8" stroke-width="3"/>` +
    `<path d="M150 90 v10 l7 5" stroke="#1f6fa8" stroke-width="3" fill="none" stroke-linecap="round"/>`,
);

const starter = robotBase(
  { slug: SLUG, version: VERSION },
  'Mind the gap',
  MIND_THE_GAP_STARTER_SKETCH,
  wideGapsArena,
  wideGapsChallenge,
);

export const mindTheGap: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: false,
  minutes: 50,
  arenaId: wideGapsArena.id,
  cover: COVER,
  title: { en: 'Mind the Gap', fa: 'مراقب فاصله باش' },
  summary: {
    en: 'The tape on this oval breaks off in the middle of the bends. Give your robot a memory, which way and how long ago it last saw the line, so it keeps curving across the gaps and finds its way back if it slips off.',
    fa: 'نوار این پیست بیضی وسط پیچ‌ها قطع شده. به رباتت حافظه بده، این‌که خط را آخرین بار در کدام سمت و چند وقت پیش دیده، تا روی فاصله‌ها همچنان بپیچد و اگر از خط بیرون افتاد راه برگشت را پیدا کند.',
  },
  steps: [
    introStep(
      `In this project your robot laps an oval whose tape has **four 12 cm gaps**, right in the middle of the bends. Over a gap every sensor sees white, exactly as if the robot had driven off the line. A simple line follower just drives straight on there, so it leaves the curve and heads for the wall. To get across, the robot needs a **memory**.

Tip: in the **Robot** view the chassis is labelled **FRONT**, **BACK**, **LEFT** and **RIGHT**. "Left motor" always means the wheel on the robot's own left when it drives forward, not the left of your screen.`,
      `در این پروژه رباتت دور یک پیست بیضی می‌چرخد که نوارش درست وسط پیچ‌ها **چهار جا به اندازهٔ ۱۲ سانتی‌متر قطع شده**. روی هر فاصله همهٔ سنسورها سفید می‌بینند، درست مثل وقتی که ربات از خط بیرون رفته. ربات تعقیب خط ساده آن‌جا فقط مستقیم جلو می‌رود، پس از پیچ بیرون می‌زند و به سمت دیوار می‌رود. ربات برای رد شدن به **حافظه** نیاز دارد.

نکته: در نمای **ربات** روی شاسی **جلو**، **عقب**، **چپ** و **راست** نوشته شده. «موتور چپ» یعنی چرخی که وقتی ربات رو به جلو می‌رود در سمت چپِ خودِ ربات است، نه سمت چپ صفحه‌ات.`,
    ),
    ...DRIVE_STEPS,
    {
      id: 'sensor',
      title: { en: 'Add the line sensor', fa: 'سنسور خط را اضافه کن' },
      body: {
        en: `The **3-channel line sensor** has three infrared eyes, **L**, **C** and **R**. Each output reads **HIGH** over the black line and **LOW** over the white floor.

![The line sensor under the front of the robot](asset:sensor)

Add a **3-channel line sensor** and put it on the robot: it goes under the **front bracket**, so check the FRONT label in the Robot view. Connect **VCC → 5V**, **GND → GND** and **L, C, R** to three digital pins, for example **D2, D3, D4**.`,
        fa: `**سنسور خط سه‌کاناله** سه چشم مادون‌قرمز دارد: **L**، **C** و **R**. هر خروجی روی خط سیاه **HIGH** و روی زمین سفید **LOW** است.

![سنسور خط زیر جلوی ربات](asset:sensor)

یک **سنسور خط سه‌کاناله** اضافه کن و روی ربات بگذار: زیر **براکت جلو** قرار می‌گیرد، پس برچسب «جلو» را در نمای ربات نگاه کن. **VCC ← 5V**، **GND ← GND** و **L، C، R** را به سه پایهٔ دیجیتال وصل کن، مثلاً **D2، D3، D4**.`,
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
      title: { en: 'Give the robot a memory', fa: 'به ربات حافظه بده' },
      body: {
        en: `Open the **Code** tab and replace each pin number **0** with the pin you wired, for example \`const int CENTER = 3;\`.

A simple line follower only looks at what its sensors see **right now**. On all-white it has no idea what to do: try the line-follower sketch here and it shoots straight off the first bend. This sketch keeps two **variables** that survive from one \`loop()\` to the next, and that is the robot's memory:

- \`lastSeen\`: the side an outer eye last saw the line on (−1 left, 1 right). On a bend the line keeps drifting to the inside, so this also tells which way the track is bending.
- \`lastLine\`: **when** that was. \`millis()\` counts the milliseconds since the Arduino started, so \`millis() - lastLine\` is how long the line has been gone.

![Crossing a gap from memory](asset:gap)

Now all-white has two meanings:

- Gone for less than \`GAP_MS\` (800 ms): almost certainly a **gap**. The robot keeps curving towards \`lastSeen\`, the way the line was bending, and picks it up on the other side.
- Gone for longer: the robot has really **lost** the line. It circles back towards \`lastSeen\`, because that is where the line went.

Why \`millis()\` and not \`delay()\`? \`delay()\` freezes the Arduino: during it the robot cannot look at its sensors. With \`millis()\` the loop keeps running and reacting while it measures time.`,
        fa: `زبانهٔ **کد** را باز کن و هر شمارهٔ پایهٔ **0** را با پایه‌ای که سیم‌کشی کرده‌ای عوض کن، مثلاً \`const int CENTER = 3;\`.

یک ربات تعقیب خط ساده فقط به چیزی نگاه می‌کند که سنسورهایش **همین الان** می‌بینند. وقتی همه سفید باشد نمی‌داند چه کند: اگر برنامهٔ ربات تعقیب خط را این‌جا امتحان کنی، سر اولین پیچ مستقیم بیرون می‌زند. این برنامه دو **متغیر** نگه می‌دارد که از یک دور \`loop()\` به دور بعد باقی می‌مانند و حافظهٔ ربات همین‌هاست:

- \`lastSeen\`: آخرین باری که یکی از چشم‌های کناری خط را دید، خط در کدام سمت بود (۱- چپ، ۱ راست). سر پیچ خط مدام به سمت داخل پیچ می‌رود، پس این متغیر نشان می‌دهد پیست به کدام طرف می‌پیچد.
- \`lastLine\`: آن لحظه **کی** بود. \`millis()\` میلی‌ثانیه‌های گذشته از روشن شدن آردوینو را می‌شمارد، پس \`millis() - lastLine\` یعنی خط چند وقت است که ناپدید شده.

![رد شدن از فاصله با کمک حافظه](asset:gap)

حالا «همه سفید» دو معنی دارد:

- کمتر از \`GAP_MS\` (۸۰۰ میلی‌ثانیه) گذشته: به احتمال زیاد یک **فاصله** است. ربات همچنان به سمت \`lastSeen\` می‌پیچد، همان طرفی که خط می‌پیچید، و آن طرف فاصله دوباره خط را پیدا می‌کند.
- بیشتر گذشته: ربات واقعاً خط را **گم کرده**. با یک دور به سمت \`lastSeen\` برمی‌گردد، چون خط به همان طرف رفته بود.

چرا \`millis()\` و نه \`delay()\`؟ \`delay()\` آردوینو را متوقف می‌کند و در آن مدت ربات نمی‌تواند به سنسورهایش نگاه کند. با \`millis()\` حلقه همچنان اجرا می‌شود و ربات در حین اندازه‌گیری زمان هم واکنش نشان می‌دهد.`,
      },
      checks: [
        ...DRIVE_CODE_CHECKS,
        ...(['left', 'center', 'right'] as const).map((pin): GuidedCheckInput => ({
          kind: 'code',
          use: 'digitalRead',
          at: sensor(pin),
        })),
      ],
      solution: MIND_THE_GAP_PINS,
    },
    {
      id: 'run',
      title: { en: 'Run a lap', fa: 'یک دور بزن' },
      body: {
        en: 'Press **Run** and watch the gaps on the bends: where the line stops, the robot keeps turning the way the track bends and finds the tape again on the other side. Without that memory it would drive straight on into the wall. Finish a full lap of the oval.',
        fa: '**اجرا** را بزن و فاصله‌های سر پیچ‌ها را تماشا کن: جایی که خط تمام می‌شود ربات همچنان در جهت پیچ می‌پیچد و آن طرف دوباره نوار را پیدا می‌کند. بدون این حافظه مستقیم جلو می‌رفت و به دیوار می‌خورد. یک دور کامل بیضی را تمام کن.',
      },
      checks: [{ kind: 'run' }],
      hints: {
        notRun: {
          en: 'Run the robot for a full lap. If it starts circling in the middle of a gap, make GAP_MS bigger; if it wanders far off the track before turning back, make it smaller. If it turns away from the line instead of towards it, check the LEFT/RIGHT labels in the Robot view and the motor wires on OUT1–OUT4.',
          fa: 'ربات را برای یک دور کامل اجرا کن. اگر وسط فاصله شروع به دور زدن می‌کند، GAP_MS را بزرگ‌تر کن؛ اگر خیلی از پیست دور می‌شود و دیر برمی‌گردد، کوچک‌ترش کن. اگر به جای سمت خط به سمت مخالف می‌پیچد، برچسب‌های چپ/راست را در نمای ربات و سیم‌های موتور روی OUT1 تا OUT4 را بررسی کن.',
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
    MIND_THE_GAP_SOLUTION_SKETCH,
  ),
  assets: { base: BASE_SVG, pwm: PWM_SVG, sensor: LINE_SENSOR_SVG, gap: GAP_SVG },
};
