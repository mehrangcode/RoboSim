import type { GuidedCheckInput, GuidedStepInput } from '@robosim/shared';

/* Steps both robots share: meet the base, add the L298N and motors, power and control them. */

const DRV = 'driver.l298n';
const MOTOR = 'actuator.tt-motor';
const drv = (pin: string) => ({ type: DRV, pin });

export const introStep = (en: string, fa: string): GuidedStepInput => ({
  id: 'intro',
  title: { en: 'Meet your robot', fa: 'با ربات آشنا شو' },
  body: {
    en: `${en}

The chassis, the **Arduino Uno**, a **4×AA battery pack** and its **switch** are already on the robot, and the pack's **+** already goes to the switch. You will add the rest one step at a time; each step turns green by itself when your circuit is right.

![The robot base seen from above](asset:base)

Use the **parts library** to add parts, drag them onto the robot in the **Robot** view, and draw wires by dragging from one pin to another.`,
    fa: `${fa}

شاسی، **آردوینو Uno**، **جاباتری ۴ تایی قلمی** و **کلید** آن از قبل روی ربات هستند و **+** باتری هم به کلید وصل شده است. بقیه را مرحله به مرحله اضافه می‌کنی؛ هر مرحله وقتی مدارت درست باشد خودش سبز می‌شود.

![پایهٔ ربات از بالا](asset:base)

قطعه‌ها را از **کتابخانهٔ قطعات** اضافه کن، در نمای **ربات** آن‌ها را روی ربات بکش و برای سیم‌کشی از یک پایه به پایهٔ دیگر بکش.`,
  },
});

export const driverStep: GuidedStepInput = {
  id: 'driver',
  title: { en: 'Add the motor driver', fa: 'درایور موتور را اضافه کن' },
  body: {
    en: `An Arduino pin can give only about 20 mA, far too little for a motor. The **L298N motor driver** takes the battery's current and switches it to two motors, following small signals from the Arduino.

Add an **L298N** and put it on the robot.`,
    fa: `هر پایهٔ آردوینو فقط حدود ۲۰ میلی‌آمپر جریان می‌دهد که برای موتور خیلی کم است. **درایور موتور L298N** جریان باتری را می‌گیرد و با فرمان‌های کوچک آردوینو آن را به دو موتور می‌رساند.

یک **L298N** اضافه کن و آن را روی ربات بگذار.`,
  },
  checks: [{ kind: 'part', type: DRV, onRobot: true }],
};

export const jumperStep: GuidedStepInput = {
  id: 'jumpers',
  title: { en: 'Set the driver’s jumpers', fa: 'جامپرهای درایور را تنظیم کن' },
  body: {
    en: `The L298N has three small jumpers. Select the driver and, in the **Properties** panel, take all three off:

- **ENA jumper** and **ENB jumper**: with them on, the motors always run at full speed. Off, the Arduino controls the speed.
- **5 V regulator jumper**: the regulator needs more than 7 V and four AA cells give 6 V, so the Arduino will supply the driver's 5 V instead.`,
    fa: `L298N سه جامپر کوچک دارد. درایور را انتخاب کن و در پنل **ویژگی‌ها** هر سه را بردار:

- **جامپر ENA** و **جامپر ENB**: وقتی وصل باشند موتورها همیشه با حداکثر سرعت می‌چرخند. با برداشتنشان، آردوینو سرعت را کنترل می‌کند.
- **جامپر رگولاتور ۵ ولت**: رگولاتور بیش از ۷ ولت لازم دارد و چهار باتری قلمی ۶ ولت می‌دهند، پس ۵ ولت درایور را آردوینو تأمین می‌کند.`,
  },
  checks: [
    { kind: 'prop', type: DRV, prop: 'enaJumper', equals: false },
    { kind: 'prop', type: DRV, prop: 'enbJumper', equals: false },
    { kind: 'prop', type: DRV, prop: 'regulatorJumper', equals: false },
  ],
  hints: {
    propMismatch: {
      en: 'Select the L298N and untick the jumper in the Properties panel.',
      fa: 'L298N را انتخاب کن و تیک جامپر را در پنل ویژگی‌ها بردار.',
    },
  },
};

export const motorsStep: GuidedStepInput = {
  id: 'motors',
  title: { en: 'Add two motors', fa: 'دو موتور اضافه کن' },
  body: {
    en: 'Add two **TT gear motors** and put them on the robot. Each one drops into its side’s motor slot and turns one wheel.',
    fa: 'دو **موتور گیربکس‌دار TT** اضافه کن و روی ربات بگذار. هر کدام در جای موتور یک طرف می‌نشیند و یک چرخ را می‌چرخاند.',
  },
  checks: [{ kind: 'part', type: MOTOR, count: 2, onRobot: true }],
};

export const motorWiresStep: GuidedStepInput = {
  id: 'motor-wires',
  title: { en: 'Wire the motors to the driver', fa: 'موتورها را به درایور وصل کن' },
  body: {
    en: `Each motor has two terminals, **M1** and **M2**. Connect:

- left motor **M1 → OUT1** and **M2 → OUT2**
- right motor **M1 → OUT3** and **M2 → OUT4**

If a motor is wired the other way round it simply turns backwards, so keep the order.`,
    fa: `هر موتور دو پایه دارد: **M1** و **M2**. این‌ها را وصل کن:

- موتور چپ: **M1 ← OUT1** و **M2 ← OUT2**
- موتور راست: **M1 ← OUT3** و **M2 ← OUT4**

اگر موتوری برعکس وصل شود فقط برعکس می‌چرخد، پس ترتیب را رعایت کن.`,
  },
  checks: [
    { kind: 'connected', a: { type: MOTOR, pin: 'm1' }, b: drv('out1') },
    { kind: 'connected', a: { type: MOTOR, pin: 'm2' }, b: drv('out2') },
    { kind: 'connected', a: { type: MOTOR, pin: 'm1' }, b: drv('out3') },
    { kind: 'connected', a: { type: MOTOR, pin: 'm2' }, b: drv('out4') },
  ],
};

export const powerStep: GuidedStepInput = {
  id: 'power',
  title: { en: 'Power the driver', fa: 'برق درایور را وصل کن' },
  body: {
    en: `Now give the driver power:

- switch **B → VS** (motor power, through the switch)
- battery **− → GND** on the Arduino
- driver **GND → GND** on the Arduino: every part must share one ground, or signals mean nothing
- Arduino **5V → 5V** on the driver (its logic supply)`,
    fa: `حالا برق درایور را وصل کن:

- پایهٔ **B** کلید **← VS** (برق موتورها از طریق کلید)
- **−** باتری **← GND** آردوینو
- **GND** درایور **← GND** آردوینو: همهٔ قطعه‌ها باید زمین مشترک داشته باشند، وگرنه سیگنال‌ها بی‌معنی می‌شوند
- **5V** آردوینو **← 5V** درایور (برق مدار منطقی آن)`,
  },
  checks: [
    { kind: 'connected', a: { type: 'power.switch', pin: 'b' }, b: drv('vs') },
    { kind: 'boardPin', pin: { type: 'power.battery-4aa', pin: 'neg' }, pinKind: 'ground' },
    { kind: 'boardPin', pin: drv('gnd'), pinKind: 'ground' },
    { kind: 'boardPin', pin: drv('v5'), pinKind: '5v' },
  ],
};

export const speedStep: GuidedStepInput = {
  id: 'speed',
  title: { en: 'Speed pins on PWM', fa: 'پایه‌های سرعت روی PWM' },
  body: {
    en: `**ENA** and **ENB** set each motor's speed. The Arduino sets a speed by switching a pin on and off very fast (**PWM**), and only the pins marked **~** can do that: D3, D5, D6, D9, D10 and D11.

![PWM pins on the Uno](asset:pwm)

Connect **ENA** and **ENB** to two different PWM pins, for example **D5** and **D6**.`,
    fa: `**ENA** و **ENB** سرعت هر موتور را تعیین می‌کنند. آردوینو سرعت را با روشن و خاموش کردن خیلی سریع یک پایه (**PWM**) تنظیم می‌کند و فقط پایه‌هایی که علامت **~** دارند این کار را بلدند: D3، D5، D6، D9، D10 و D11.

![پایه‌های PWM روی Uno](asset:pwm)

**ENA** و **ENB** را به دو پایهٔ PWM متفاوت وصل کن، مثلاً **D5** و **D6**.`,
  },
  checks: [
    { kind: 'boardPin', pin: drv('ena'), pinKind: 'pwm' },
    { kind: 'boardPin', pin: drv('enb'), pinKind: 'pwm' },
  ],
};

export const directionStep: GuidedStepInput = {
  id: 'direction',
  title: { en: 'Direction pins', fa: 'پایه‌های جهت' },
  body: {
    en: `**IN1/IN2** choose which way the left motor turns, **IN3/IN4** the right one. Any digital pin will do; keep D0 and D1 free for the serial monitor.

Connect **IN1–IN4** to four digital pins, for example **D7, D8, D9, D10**.`,
    fa: `**IN1/IN2** جهت چرخش موتور چپ و **IN3/IN4** جهت موتور راست را انتخاب می‌کنند. هر پایهٔ دیجیتالی مناسب است؛ D0 و D1 را برای مانیتور سریال آزاد بگذار.

**IN1** تا **IN4** را به چهار پایهٔ دیجیتال وصل کن، مثلاً **D7، D8، D9، D10**.`,
  },
  checks: (['in1', 'in2', 'in3', 'in4'] as const).map((pin): GuidedCheckInput => ({
    kind: 'boardPin',
    pin: drv(pin),
    pinKind: 'digital',
  })),
};

/** Code checks that the sketch drives the pins the learner wired the driver to. */
export const DRIVE_CODE_CHECKS: readonly GuidedCheckInput[] = [
  { kind: 'code', use: 'analogWrite', at: drv('ena') },
  { kind: 'code', use: 'analogWrite', at: drv('enb') },
  ...(['in1', 'in2', 'in3', 'in4'] as const).map((pin): GuidedCheckInput => ({
    kind: 'code',
    use: 'digitalWrite',
    at: drv(pin),
  })),
];

export const DRIVE_STEPS: readonly GuidedStepInput[] = [
  driverStep,
  jumperStep,
  motorsStep,
  motorWiresStep,
  powerStep,
  speedStep,
  directionStep,
];
