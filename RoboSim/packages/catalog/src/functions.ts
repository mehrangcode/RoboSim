/**
 * Controlled function vocabulary (FR-CIR-12, ADR-028): what a part is *for*, so the library can be
 * searched by purpose ("measure distance", «اندازه‌گیری فاصله»). Manifests list these ids in
 * `functions`; labels and the generic "why" text live in i18n `components:functions.<id>.label|why`.
 *
 * Synonyms of both languages are searched whatever the UI language. Persian morphology (plural «ها»,
 * ezafe) is covered by listing forms here, not by stemming; words that carry the meaning ("two") get
 * their own id (`drive-two-dc-motors`). Engine-free: no component package is imported.
 */
export interface PartFunction {
  /** Kebab-case id, e.g. 'measure-distance'. */
  readonly id: string;
  readonly synonyms: { readonly en: readonly string[]; readonly fa: readonly string[] };
}

const fn = (id: string, en: readonly string[], fa: readonly string[]): PartFunction => ({
  id,
  synonyms: { en, fa },
});

export const PART_FUNCTIONS: readonly PartFunction[] = [
  // Sensing
  fn(
    'measure-distance',
    [
      'measure distance',
      'distance sensor',
      'range finder',
      'how far',
      'ultrasonic',
      'time of flight',
      'lidar',
    ],
    [
      'اندازه‌گیری فاصله',
      'سنجش فاصله',
      'سنسور فاصله',
      'فاصله سنج',
      'مسافت سنج',
      'التراسونیک',
      'اولتراسونیک',
      'لیزری',
    ],
  ),
  fn(
    'detect-obstacle',
    ['detect obstacle', 'obstacle sensor', 'avoid obstacles', 'object detection', 'proximity'],
    ['تشخیص مانع', 'سنسور مانع', 'دوری از مانع', 'تشخیص جسم', 'مجاورت'],
  ),
  fn(
    'detect-collision',
    ['detect collision', 'bump sensor', 'crash sensor', 'touch wall', 'limit switch'],
    ['تشخیص برخورد', 'سنسور برخورد', 'سنسور ضربه', 'لیمیت سوییچ', 'میکروسوییچ'],
  ),
  fn(
    'follow-line',
    ['follow line', 'line follower', 'line sensor', 'black line', 'line tracking', 'reflectance'],
    ['دنبال کردن خط', 'تعقیب خط', 'مسیریاب', 'سنسور خط', 'خط سیاه', 'ردیاب خط', 'بازتاب'],
  ),
  fn(
    'measure-temperature',
    ['measure temperature', 'temperature sensor', 'thermometer', 'heat', 'temp'],
    ['اندازه‌گیری دما', 'سنجش دما', 'سنسور دما', 'دماسنج', 'حرارت', 'دما'],
  ),
  fn(
    'measure-humidity',
    ['measure humidity', 'humidity sensor', 'air moisture', 'hygrometer'],
    ['اندازه‌گیری رطوبت', 'سنسور رطوبت', 'رطوبت هوا', 'رطوبت سنج', 'نم هوا'],
  ),
  fn(
    'measure-pressure',
    ['measure pressure', 'air pressure', 'barometer', 'altitude', 'altimeter'],
    ['اندازه‌گیری فشار', 'فشار هوا', 'فشارسنج', 'ارتفاع', 'ارتفاع سنج'],
  ),
  fn(
    'measure-soil-moisture',
    ['measure soil moisture', 'soil moisture', 'plant watering', 'wet soil', 'dry soil'],
    ['رطوبت خاک', 'سنسور رطوبت خاک', 'آبیاری گیاه', 'خاک خشک', 'گلدان'],
  ),
  fn(
    'sense-light',
    ['sense light', 'light sensor', 'brightness', 'day night', 'dark detection', 'photoresistor'],
    ['حس نور', 'سنسور نور', 'تشخیص نور', 'روشنایی', 'شب و روز', 'تاریکی', 'فتوسل'],
  ),
  fn(
    'detect-motion',
    ['detect motion', 'motion sensor', 'movement', 'presence', 'person detection', 'pir'],
    ['تشخیص حرکت', 'سنسور حرکت', 'حضور', 'تشخیص انسان', 'دزدگیر'],
  ),
  fn(
    'detect-sound',
    ['detect sound', 'sound sensor', 'microphone', 'clap', 'noise level'],
    ['تشخیص صدا', 'سنسور صدا', 'میکروفون', 'دست زدن', 'سطح صدا'],
  ),
  fn(
    'measure-tilt',
    ['measure tilt', 'tilt sensor', 'angle sensor', 'orientation', 'balance', 'inclination'],
    ['اندازه‌گیری شیب', 'سنسور شیب', 'زاویه', 'جهت گیری', 'تعادل', 'کج شدن'],
  ),
  fn(
    'measure-acceleration',
    ['measure acceleration', 'accelerometer', 'shake', 'vibration', 'imu'],
    ['اندازه‌گیری شتاب', 'شتاب سنج', 'لرزش', 'تکان'],
  ),
  fn(
    'measure-rotation',
    ['measure rotation', 'gyroscope', 'turn rate', 'count turns', 'rotation sensor'],
    ['اندازه‌گیری چرخش', 'ژیروسکوپ', 'سرعت چرخش', 'شمارش دور', 'سنسور چرخش'],
  ),
  // User input
  fn(
    'user-input-button',
    ['button', 'push button', 'press', 'click', 'user input', 'tactile switch'],
    ['دکمه', 'کلید فشاری', 'فشار دادن', 'ورودی کاربر', 'تک سوییچ'],
  ),
  fn(
    'user-input-knob',
    ['knob', 'dial', 'turn to adjust', 'set a value', 'volume control'],
    ['پیچ تنظیم', 'ولوم', 'تنظیم مقدار', 'چرخاندن', 'دستگیره'],
  ),
  fn(
    'user-input-joystick',
    ['joystick', 'thumb stick', 'game controller', 'two axis input', 'remote control'],
    ['جوی استیک', 'دسته بازی', 'کنترل دو محوره', 'کنترل دستی'],
  ),
  fn(
    'user-input-keypad',
    ['keypad', 'enter a code', 'password', 'number keys', 'pin code'],
    ['کیپد', 'صفحه کلید', 'وارد کردن رمز', 'رمز', 'کلیدهای عددی'],
  ),
  // Motion
  fn(
    'drive-dc-motor',
    ['drive motor', 'drive dc motor', 'motor driver', 'motor speed', 'motor direction', 'h bridge'],
    ['راه اندازی موتور', 'درایور موتور', 'کنترل موتور', 'سرعت موتور', 'جهت موتور', 'پل اچ'],
  ),
  fn(
    'drive-two-dc-motors',
    [
      'drive two motors',
      'two motors',
      'dual motor driver',
      'two wheels',
      'both wheels',
      'differential drive',
    ],
    ['راه اندازی دو موتور', 'دو موتور', 'درایور دو موتور', 'دو چرخ', 'هر دو چرخ', 'دو کاناله'],
  ),
  fn(
    'drive-stepper',
    ['drive stepper', 'stepper driver', 'stepper motor driver'],
    ['راه اندازی استپر', 'درایور استپر', 'درایور استپر موتور', 'راه اندازی موتور پله ای'],
  ),
  fn(
    'spin-wheel',
    ['spin wheel', 'dc motor', 'gear motor', 'wheel motor', 'make it move', 'robot wheel'],
    ['چرخاندن چرخ', 'موتور دی سی', 'موتور گیربکس', 'موتور چرخ', 'حرکت ربات', 'چرخ ربات'],
  ),
  fn(
    'move-to-angle',
    ['move to angle', 'servo', 'rotate to position', 'robot arm', 'steering', 'gripper'],
    ['چرخش به زاویه', 'سروو', 'سرو موتور', 'بازوی ربات', 'فرمان', 'گیره'],
  ),
  fn(
    'rotate-in-steps',
    ['rotate in steps', 'stepper motor', 'precise rotation', 'exact position'],
    ['چرخش پله ای', 'استپر موتور', 'موتور پله ای', 'چرخش دقیق', 'موقعیت دقیق'],
  ),
  // Output
  fn(
    'show-text',
    ['show text', 'display text', 'screen', 'lcd', 'print message'],
    ['نمایش متن', 'نمایشگر', 'صفحه نمایش', 'ال سی دی', 'نوشتن پیام'],
  ),
  fn(
    'show-number',
    ['show number', 'display digits', 'counter display', 'score display', 'clock digits'],
    ['نمایش عدد', 'نمایش رقم', 'نمایشگر عدد', 'شمارنده', 'سون سگمنت', 'هفت قسمتی'],
  ),
  fn(
    'show-graphics',
    ['show graphics', 'draw shapes', 'pixel display', 'graph on screen', 'oled'],
    ['نمایش گرافیک', 'رسم شکل', 'نمایشگر گرافیکی', 'نمودار روی صفحه', 'او ال ای دی'],
  ),
  fn(
    'show-status-light',
    ['status light', 'indicator', 'blink', 'light up', 'lamp'],
    ['چراغ وضعیت', 'نشانگر', 'چشمک زن', 'روشن کردن چراغ', 'لامپ', 'ال ای دی'],
  ),
  fn(
    'show-colors',
    ['show colors', 'rgb', 'mix colors', 'color light', 'rainbow'],
    ['نمایش رنگ', 'رنگی', 'ترکیب رنگ', 'نور رنگی', 'رنگین کمان'],
  ),
  fn(
    'light-strip',
    ['led strip', 'addressable leds', 'neopixel', 'light many leds', 'decoration lights'],
    ['نوار ال ای دی', 'ریسه', 'نئوپیکسل', 'ال ای دی آدرس پذیر', 'نورپردازی'],
  ),
  fn(
    'make-sound',
    ['make sound', 'beep', 'alarm', 'buzzer', 'alert'],
    ['تولید صدا', 'بوق', 'آژیر', 'بیزر', 'هشدار', 'زنگ'],
  ),
  fn(
    'play-tone',
    ['play tone', 'play melody', 'music', 'notes', 'tone frequency'],
    ['پخش نت', 'پخش آهنگ', 'موسیقی', 'ملودی', 'فرکانس صدا'],
  ),
  // Switching
  fn(
    'switch-high-current',
    [
      'switch high current',
      'switch big load',
      'power switch',
      'control a pump',
      'control a lamp',
      'switch motor',
    ],
    [
      'کلید زنی جریان بالا',
      'سوییچ بار سنگین',
      'کنترل پمپ',
      'کنترل لامپ',
      'روشن خاموش کردن موتور',
      'جریان زیاد',
    ],
  ),
  fn(
    'switch-small-load',
    ['switch small load', 'transistor switch', 'switch led', 'switch buzzer', 'low side switch'],
    ['کلید زنی بار کوچک', 'ترانزیستور سوییچ', 'روشن کردن ال ای دی', 'کلید ترانزیستوری'],
  ),
  fn(
    'isolate-load',
    ['isolate load', 'relay', 'separate circuit', 'switch ac', 'mains appliance'],
    ['ایزوله کردن بار', 'رله', 'مدار جدا', 'برق شهر', 'وسیله برقی'],
  ),
  fn(
    'amplify-signal',
    ['amplify signal', 'amplifier', 'boost current', 'current gain'],
    ['تقویت سیگنال', 'تقویت کننده', 'تقویت جریان', 'بهره جریان'],
  ),
  // Power
  fn(
    'regulate-5v',
    ['regulate 5v', '5v', '5 volt', 'five volts', '5v regulator', 'make 5v'],
    ['تنظیم 5 ولت', '5 ولت', 'پنج ولت', 'رگولاتور 5 ولت', 'ساخت 5 ولت'],
  ),
  fn(
    'regulate-3v3',
    ['regulate 3.3v', '3.3v', '3.3 volt', '3v3', '3.3v regulator'],
    ['تنظیم 3.3 ولت', '3.3 ولت', 'سه و سه دهم ولت', 'رگولاتور 3.3 ولت'],
  ),
  fn(
    'step-down-voltage',
    ['step down voltage', 'lower voltage', 'voltage regulator', 'buck converter', 'reduce voltage'],
    ['کاهش ولتاژ', 'پایین آوردن ولتاژ', 'رگولاتور ولتاژ', 'مبدل باک', 'تثبیت ولتاژ'],
  ),
  fn(
    'supply-battery-power',
    ['battery', 'power supply', 'portable power', 'power the robot', 'cells'],
    ['باتری', 'منبع تغذیه', 'تغذیه', 'برق ربات', 'باتری قلمی', 'باطری'],
  ),
  fn(
    'switch-power',
    ['switch power', 'on off switch', 'power switch', 'turn on', 'toggle switch'],
    ['کلید روشن خاموش', 'کلید قطع و وصل', 'کلید برق', 'روشن کردن', 'کلید دو حالته'],
  ),
  fn(
    'store-energy',
    ['store energy', 'capacitor', 'charge storage', 'timing capacitor', 'decoupling'],
    ['ذخیره انرژی', 'خازن', 'ذخیره بار', 'خازن زمان بندی', 'دکاپلینگ'],
  ),
  fn(
    'smooth-voltage',
    ['smooth voltage', 'filter ripple', 'reduce noise', 'stabilize supply', 'filter capacitor'],
    ['صاف کردن ولتاژ', 'فیلتر ریپل', 'کاهش نویز', 'پایدار کردن تغذیه', 'خازن صافی'],
  ),
  // Passives and protection
  fn(
    'limit-current',
    ['limit current', 'resistor', 'current limiting', 'protect led', 'series resistor'],
    ['محدود کردن جریان', 'مقاومت', 'محافظت ال ای دی', 'مقاومت سری'],
  ),
  fn(
    'divide-voltage',
    ['divide voltage', 'voltage divider', 'scale voltage', 'read battery voltage'],
    ['تقسیم ولتاژ', 'تقسیم کننده ولتاژ', 'مقسم ولتاژ', 'خواندن ولتاژ باتری'],
  ),
  fn(
    'pull-up-input',
    ['pull up', 'pull down', 'stop floating input', 'default level'],
    ['پول آپ', 'پول دان', 'ورودی شناور', 'سطح پیش فرض'],
  ),
  fn(
    'block-reverse-current',
    ['block reverse current', 'diode', 'one way current', 'reverse polarity protection', 'rectify'],
    ['جلوگیری از جریان معکوس', 'دیود', 'جریان یک طرفه', 'محافظت از اتصال معکوس', 'یکسوسازی'],
  ),
  fn(
    'absorb-flyback',
    ['flyback diode', 'protect from motor spikes', 'snubber', 'freewheeling diode', 'kickback'],
    ['دیود هرزگرد', 'محافظت از ضربه موتور', 'دیود فلای بک', 'ولتاژ برگشتی'],
  ),
  fn(
    'clamp-voltage',
    ['clamp voltage', 'zener', 'voltage reference', 'overvoltage protection'],
    ['محدود کردن ولتاژ', 'زنر', 'ولتاژ مرجع', 'محافظت از اضافه ولتاژ'],
  ),
  // Logic and timing
  fn(
    'logic-gate',
    ['logic gate', 'and gate', 'or gate', 'nand', 'xor', 'not gate', 'boolean logic'],
    ['گیت منطقی', 'گیت اند', 'گیت اور', 'نند', 'ایکس اور', 'گیت نات', 'منطق بولی'],
  ),
  fn(
    'clean-up-signal',
    ['clean up signal', 'schmitt trigger', 'debounce', 'square up', 'invert signal'],
    ['تمیز کردن سیگنال', 'اشمیت تریگر', 'حذف لرزش کلید', 'معکوس کردن سیگنال'],
  ),
  fn(
    'expand-outputs',
    ['expand outputs', 'more pins', 'shift register', 'many leds', 'save pins'],
    ['افزایش خروجی', 'پایه بیشتر', 'شیفت رجیستر', 'ال ای دی های زیاد', 'صرفه جویی در پایه'],
  ),
  fn(
    'count-pulses',
    ['count pulses', 'counter', 'sequence leds', 'chaser', 'decade counter'],
    ['شمارش پالس', 'شمارنده', 'ترتیب ال ای دی', 'چراغ دنباله دار', 'شمارنده دهدهی'],
  ),
  fn(
    'generate-pulses',
    ['generate pulses', 'timer', 'oscillator', 'blink without code', 'clock signal', 'pwm generator'],
    ['تولید پالس', 'تایمر', 'نوسان ساز', 'چشمک زن بدون کد', 'سیگنال کلاک', 'تولید پی دبلیو ام'],
  ),
  // Building
  fn(
    'prototype-connections',
    ['breadboard', 'prototype', 'connect parts', 'solderless', 'build a circuit'],
    ['برد بورد', 'بردبورد', 'نمونه سازی', 'اتصال قطعات', 'بدون لحیم', 'ساخت مدار'],
  ),
  fn(
    'build-robot-base',
    ['robot chassis', 'robot base', 'robot car', 'body', 'frame'],
    ['شاسی ربات', 'بدنه ربات', 'ماشین ربات', 'بدنه', 'اسکلت'],
  ),
];

const BY_ID = new Map(PART_FUNCTIONS.map((f) => [f.id, f]));

export function functionById(id: string): PartFunction | undefined {
  return BY_ID.get(id);
}
