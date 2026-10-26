import type { GuidedCheckInput } from '@robosim/shared';
import { ovalArena, ovalChallenge } from '../arenas/oval.js';
import { BASE_SVG, LINE_SENSOR_SVG, LINE_FOLLOWER_COVER, PWM_SVG } from './assets.js';
import { DRIVE_CODE_CHECKS, DRIVE_STEPS, introStep } from './drive-steps.js';
import { DRIVE_PARTS, DRIVE_WIRES, finished, g, part, robotBase, slot } from './robot.js';
import {
  LINE_FOLLOWER_PINS,
  LINE_FOLLOWER_SOLUTION_SKETCH,
  LINE_FOLLOWER_STARTER_SKETCH,
} from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'line-follower';
const VERSION = 1;
const SENSOR = 'sensor.line-3ch';
const sensor = (pin: string) => ({ type: SENSOR, pin });

const starter = robotBase(
  { slug: SLUG, version: VERSION },
  'Line-follower robot',
  LINE_FOLLOWER_STARTER_SKETCH,
  ovalArena,
  ovalChallenge,
);

export const lineFollower: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: true,
  minutes: 45,
  arenaId: ovalArena.id,
  cover: LINE_FOLLOWER_COVER,
  title: { en: 'Line-follower robot', fa: 'ربات تعقیب خط' },
  summary: {
    en: 'Build a two-wheeled robot that follows a black line around the oval track: motor driver, motors, a line sensor and your first robot sketch.',
    fa: 'رباتی دوچرخ بساز که خط سیاه را دور پیست بیضی دنبال می‌کند: درایور موتور، موتورها، سنسور خط و اولین برنامهٔ رباتت.',
  },
  steps: [
    introStep(
      'In this project you build a robot that follows a black line around an oval track and finishes a full lap.',
      'در این پروژه رباتی می‌سازی که خط سیاه را دور یک پیست بیضی دنبال می‌کند و یک دور کامل می‌زند.',
    ),
    ...DRIVE_STEPS,
    {
      id: 'sensor',
      title: { en: 'Add the line sensor', fa: 'سنسور خط را اضافه کن' },
      body: {
        en: `The **3-channel line sensor** has three infrared eyes that look at the floor. Each output reads **HIGH** over the black line and **LOW** over the white floor.

![The line sensor under the front of the robot](asset:sensor)

Add a **3-channel line sensor** and put it on the robot (it goes under the front bracket). Then connect **VCC → 5V**, **GND → GND** and its outputs **L, C, R** to three digital pins, for example **D2, D3, D4**.`,
        fa: `**سنسور خط سه‌کاناله** سه چشم مادون‌قرمز دارد که به زمین نگاه می‌کنند. هر خروجی روی خط سیاه **HIGH** و روی زمین سفید **LOW** است.

![سنسور خط زیر جلوی ربات](asset:sensor)

یک **سنسور خط سه‌کاناله** اضافه کن و روی ربات بگذار (زیر براکت جلو قرار می‌گیرد). بعد **VCC ← 5V**، **GND ← GND** و خروجی‌های **L، C، R** را به سه پایهٔ دیجیتال وصل کن، مثلاً **D2، D3، D4**.`,
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
      title: { en: 'Tell the sketch your pins', fa: 'پایه‌ها را به برنامه بگو' },
      body: {
        en: `Open the **Code** tab. The sketch already knows how to follow a line, but every pin number is **0**. Replace each 0 with the pin you wired, for example \`const int ENA = 5;\`.

The robot turns towards the side where a sensor sees the line, and drives straight when only the centre one does.`,
        fa: `زبانهٔ **کد** را باز کن. برنامه از قبل بلد است خط را دنبال کند، اما شمارهٔ همهٔ پایه‌ها **0** است. هر 0 را با پایه‌ای که سیم‌کشی کرده‌ای عوض کن، مثلاً \`const int ENA = 5;\`.

ربات به سمتی می‌پیچد که سنسور آن طرف خط را می‌بیند و وقتی فقط سنسور وسط خط را ببیند مستقیم می‌رود.`,
      },
      checks: [
        ...DRIVE_CODE_CHECKS,
        ...(['left', 'center', 'right'] as const).map((pin): GuidedCheckInput => ({
          kind: 'code',
          use: 'digitalRead',
          at: sensor(pin),
        })),
      ],
      solution: LINE_FOLLOWER_PINS,
    },
    {
      id: 'run',
      title: { en: 'Run a lap', fa: 'یک دور بزن' },
      body: {
        en: 'Press **Run**. The robot should follow the line all the way round the oval. If it leaves the track, check which way each motor turns and which sensor is on which pin, then reset and run again.',
        fa: '**اجرا** را بزن. ربات باید خط را تا آخر دور بیضی دنبال کند. اگر از پیست بیرون رفت، جهت چرخش هر موتور و این‌که هر سنسور به کدام پایه وصل است را بررسی کن، بعد ریست کن و دوباره اجرا کن.',
      },
      checks: [{ kind: 'run' }],
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
    LINE_FOLLOWER_SOLUTION_SKETCH,
  ),
  assets: { base: BASE_SVG, pwm: PWM_SVG, sensor: LINE_SENSOR_SVG },
};
