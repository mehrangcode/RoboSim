import { obstacleCourseArena, obstacleCourseChallenge } from '../arenas/open-arenas.js';
import { BASE_SVG, OBSTACLE_AVOIDER_COVER, PWM_SVG, SONAR_SVG } from './assets.js';
import { DRIVE_CODE_CHECKS, DRIVE_STEPS, introStep } from './drive-steps.js';
import { DRIVE_PARTS, DRIVE_WIRES, finished, g, part, robotBase, slot } from './robot.js';
import {
  OBSTACLE_AVOIDER_DISTANCE,
  OBSTACLE_AVOIDER_PINS,
  OBSTACLE_AVOIDER_SOLUTION_SKETCH,
  OBSTACLE_AVOIDER_STARTER_SKETCH,
} from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'obstacle-avoider';
const VERSION = 1;
const SONAR = 'sensor.hc-sr04';
const sonar = (pin: string) => ({ type: SONAR, pin });

const starter = robotBase(
  { slug: SLUG, version: VERSION },
  'Obstacle-avoiding robot',
  OBSTACLE_AVOIDER_STARTER_SKETCH,
  obstacleCourseArena,
  obstacleCourseChallenge,
);

export const obstacleAvoider: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: false,
  minutes: 50,
  arenaId: obstacleCourseArena.id,
  cover: OBSTACLE_AVOIDER_COVER,
  title: { en: 'Obstacle-avoiding robot', fa: 'ربات مانع‌گریز' },
  summary: {
    en: 'Give your robot ears: an ultrasonic sonar measures the gap ahead so the robot can steer round blocks and posts to reach the goal.',
    fa: 'به رباتت گوش بده: یک سونار فراصوتی فاصلهٔ جلو را اندازه می‌گیرد تا ربات از کنار مانع‌ها و ستون‌ها رد شود و به هدف برسد.',
  },
  steps: [
    introStep(
      'In this project you build a robot that crosses an obstacle course from the start box to the goal without getting stuck.',
      'در این پروژه رباتی می‌سازی که از جعبهٔ شروع تا هدف از یک مسیر پر از مانع عبور می‌کند و گیر نمی‌افتد.',
    ),
    ...DRIVE_STEPS,
    {
      id: 'sonar',
      title: { en: 'Add the sonar', fa: 'سونار را اضافه کن' },
      body: {
        en: `The **HC-SR04** measures distance like a bat: **TRIG** makes it send an ultrasonic click and **ECHO** stays HIGH until the echo comes back. The longer the pulse, the farther the obstacle.

![The sonar on the front of the robot](asset:sonar)

Add an **HC-SR04** and put it on the robot (it faces forward on the front). Connect **VCC → 5V**, **GND → GND**, and **TRIG** and **ECHO** to two digital pins, for example **D12** and **D11**.`,
        fa: `**HC-SR04** مثل خفاش فاصله را اندازه می‌گیرد: با **TRIG** یک صدای فراصوت می‌فرستد و **ECHO** تا برگشتن پژواک HIGH می‌ماند. هرچه پالس طولانی‌تر باشد، مانع دورتر است.

![سونار روی جلوی ربات](asset:sonar)

یک **HC-SR04** اضافه کن و روی ربات بگذار (رو به جلو، در جلوی ربات). **VCC ← 5V**، **GND ← GND** و **TRIG** و **ECHO** را به دو پایهٔ دیجیتال وصل کن، مثلاً **D12** و **D11**.`,
      },
      checks: [
        { kind: 'part', type: SONAR, onRobot: true },
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
        en: `Open the **Code** tab. Replace each pin number **0** with the pin you wired, for example \`const int TRIG = 12;\`.

\`distanceCm()\` triggers the sonar and turns the echo time into centimetres. The robot veers right when something is ahead, backs off when it is too close, and veers back left once the way is clear.`,
        fa: `زبانهٔ **کد** را باز کن. هر شمارهٔ پایهٔ **0** را با پایه‌ای که سیم‌کشی کرده‌ای عوض کن، مثلاً \`const int TRIG = 12;\`.

\`distanceCm()\` سونار را فعال می‌کند و زمان پژواک را به سانتی‌متر تبدیل می‌کند. ربات وقتی چیزی جلویش باشد به راست می‌پیچد، وقتی خیلی نزدیک باشد عقب می‌رود و وقتی راه باز شد دوباره به چپ برمی‌گردد.`,
      },
      checks: [
        ...DRIVE_CODE_CHECKS,
        { kind: 'code', use: 'digitalWrite', at: sonar('trig') },
        { kind: 'code', use: 'pinMode', at: sonar('echo') },
      ],
      solution: OBSTACLE_AVOIDER_PINS,
    },
    {
      id: 'run',
      title: { en: 'Pick a distance and reach the goal', fa: 'فاصله را انتخاب کن و به هدف برس' },
      body: {
        en: `One blank is left: \`TOO_CLOSE\`, the distance in cm at which the robot backs off. At **0** it never sees anything and drives into the first block. Try something around **20–30 cm**, press **Run**, and get to the goal on the right.`,
        fa: `یک جای خالی مانده: \`TOO_CLOSE\`، فاصله‌ای به سانتی‌متر که ربات در آن عقب می‌رود. با **0** ربات هیچ‌چیز را نمی‌بیند و به اولین مانع می‌خورد. عددی حدود **۲۰ تا ۳۰ سانتی‌متر** امتحان کن، **اجرا** را بزن و به هدف سمت راست برس.`,
      },
      checks: [{ kind: 'run' }],
      solution: OBSTACLE_AVOIDER_DISTANCE,
      hints: {
        notRun: {
          en: 'Run the robot until it reaches the goal. If it hits the first block, make TOO_CLOSE bigger; if it turns away too early and wanders, make it smaller.',
          fa: 'ربات را اجرا کن تا به هدف برسد. اگر به اولین مانع خورد TOO_CLOSE را بزرگ‌تر کن؛ اگر خیلی زود می‌پیچد و سرگردان می‌شود، کوچک‌ترش کن.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [...DRIVE_PARTS, part('sonar', SONAR, g(40), g(40), { mount: slot('front-top') })],
    [
      ...DRIVE_WIRES,
      ['board.5V', 'sonar.vcc'],
      ['sonar.gnd', 'board.GND3'],
      ['board.D12', 'sonar.trig'],
      ['sonar.echo', 'board.D11'],
    ],
    OBSTACLE_AVOIDER_SOLUTION_SKETCH,
  ),
  assets: { base: BASE_SVG, pwm: PWM_SVG, sonar: SONAR_SVG },
};
