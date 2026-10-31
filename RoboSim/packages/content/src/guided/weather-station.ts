import { benchBase } from './bench.js';
import { card, dot, uno, wire } from './bench-art.js';
import { finished, g, part } from './robot.js';
import {
  WEATHER_STATION_PINS,
  WEATHER_STATION_SOLUTION_SKETCH,
  WEATHER_STATION_STARTER_SKETCH,
} from './sketches.js';
import type { GuidedContent } from './types.js';

const SLUG = 'weather-station';
const VERSION = 1;
const DHT = 'sensor.dht11';
const dht = (pin: string) => ({ type: DHT, pin });

// A reading reaches the monitor, and warming the room past 28 °C brings up the comfort warning.
const starter = benchBase(
  { slug: SLUG, version: VERSION },
  'Desk Weather Station',
  WEATHER_STATION_STARTER_SKETCH,
  {
    id: 'too-hot',
    condition: {
      all: [
        { type: 'serialMatches', pattern: 'Temp: \\d+ C +Humidity: \\d+ %' },
        { type: 'serialMatches', pattern: 'Too hot!' },
      ],
    },
  },
);

/** The blue DHT11 module with its grille and three legs (vcc, data, gnd). */
const dht11 = (x: number, y: number): string =>
  `<g transform="translate(${x} ${y})">` +
  `<rect x="0" y="0" width="40" height="54" rx="4" fill="#29b6f6"/>` +
  Array.from({ length: 4 }, (_, r) =>
    Array.from(
      { length: 3 },
      (_, c) => `<rect x="${7 + c * 10}" y="${7 + r * 11}" width="6" height="7" fill="#0277bd"/>`,
    ).join(''),
  ).join('') +
  [10, 20, 30].map((px) => `<path d="M${px} 54 v12" stroke="#9e9e9e" stroke-width="3"/>`).join('') +
  `</g>`;

/** A thermometer, filled to `level` (0..1). */
const thermometer = (x: number, y: number, level: number): string =>
  `<rect x="${x - 6}" y="${y}" width="12" height="70" rx="6" fill="#eceff1" stroke="#90a4ae" stroke-width="2"/>` +
  `<rect x="${x - 3}" y="${y + 66 - 62 * level}" width="6" height="${62 * level + 4}" fill="#e53935"/>` +
  `<circle cx="${x}" cy="${y + 76}" r="10" fill="#e53935" stroke="#90a4ae" stroke-width="2"/>`;

/** A serial monitor window with a few “text” lines, the last one red (the warning). */
const monitor = (x: number, y: number): string =>
  `<g transform="translate(${x} ${y})">` +
  `<rect width="120" height="80" rx="6" fill="#263238"/>` +
  [62, 78, 54, 90]
    .map(
      (w, i) =>
        `<rect x="10" y="${12 + i * 16}" width="${w}" height="7" rx="2" fill="${i === 3 ? '#ef5350' : '#a5d6a7'}"/>`,
    )
    .join('') +
  `</g>`;

/** VCC to 5V, DATA to a digital pin, GND to GND. */
const WIRING_SVG = card(
  280,
  150,
  uno(14, 40) +
    dht11(190, 20) +
    dot(124, 56) +
    wire('124,56 170,56 170,100 210,100 210,86', '#f1c40f') +
    wire('124,100 150,100 150,120 200,120 200,86', '#e53935') +
    wire('124,112 140,112 140,134 220,134 220,86', '#222'),
);

const WEATHER_COVER = card(
  320,
  180,
  uno(14, 60) +
    dht11(140, 50) +
    thermometer(205, 40, 0.8) +
    monitor(230, 50) +
    wire('124,76 136,76 136,128 160,128 160,116', '#f1c40f'),
);

export const weatherStation: GuidedContent = {
  slug: SLUG,
  version: VERSION,
  free: true,
  minutes: 20,
  arenaId: null,
  cover: WEATHER_COVER,
  title: { en: 'Desk Weather Station', fa: 'ایستگاه هواشناسی رومیزی' },
  summary: {
    en: 'Measure temperature and humidity with a DHT11 sensor and its library, print them on the Serial Monitor, and warn when the room gets too hot.',
    fa: 'دما و رطوبت را با سنسور DHT11 و کتابخانه‌اش اندازه بگیر، در مانیتور سریال چاپ کن و وقتی اتاق خیلی گرم شد هشدار بده.',
  },
  steps: [
    {
      id: 'intro',
      title: { en: 'A weather station on your desk', fa: 'یک ایستگاه هواشناسی روی میزت' },
      body: {
        en: `In this project the Arduino becomes a small weather station: a **DHT11** sensor measures the room’s **temperature** and **humidity**, and every 2 seconds the readings appear on the **Serial Monitor** with a tip: comfortable, too hot, too cold, too dry or too humid.

The sensor talks to the Arduino in its own fast digital language. You will not have to learn it: the **DHT** library does the talking, and your sketch just asks for a reading and decides what to say about it with \`if\` and \`else\`.

Each step turns green by itself when your circuit is right.`,
        fa: `در این پروژه آردوینو یک ایستگاه هواشناسی کوچک می‌شود: سنسور **DHT11** **دما** و **رطوبت** اتاق را اندازه می‌گیرد و هر ۲ ثانیه خواندن‌ها همراه یک توصیه در **مانیتور سریال** می‌آیند: مطبوع، خیلی گرم، خیلی سرد، خیلی خشک یا خیلی مرطوب.

سنسور با زبان دیجیتال سریع خودش با آردوینو حرف می‌زند. لازم نیست یادش بگیری: کتابخانهٔ **DHT** حرف زدن را انجام می‌دهد و برنامه‌ات فقط یک خواندن می‌خواهد و با \`if\` و \`else\` تصمیم می‌گیرد چه بگوید.

هر مرحله وقتی مدارت درست باشد خودش سبز می‌شود.`,
      },
    },
    {
      id: 'sensor',
      title: { en: 'Power the DHT11', fa: 'به DHT11 برق بده' },
      body: {
        en: `Add a **DHT11** from the parts library. The module has three pins: **vcc**, **data** and **gnd**.

![VCC to 5V, DATA to a digital pin, GND to GND](asset:wiring)

Give it power first:

- **vcc** → **5V**
- **gnd** → **GND**`,
        fa: `از کتابخانهٔ قطعات یک **DHT11** اضافه کن. ماژول سه پایه دارد: **vcc**، **data** و **gnd**.

![VCC به 5V، DATA به یک پایهٔ دیجیتال، GND به GND](asset:wiring)

اول برقش را وصل کن:

- **vcc** ← **5V**
- **gnd** ← **GND**`,
      },
      checks: [
        { kind: 'part', type: DHT },
        { kind: 'boardPin', pin: dht('vcc'), pinKind: '5v' },
        { kind: 'boardPin', pin: dht('gnd'), pinKind: 'ground' },
      ],
    },
    {
      id: 'data',
      title: { en: 'Connect the data wire', fa: 'سیم داده را وصل کن' },
      body: {
        en: `The DHT11 sends temperature and humidity over its single **data** wire as a quick burst of 40 bits, at most about once a second. The module already has the pull-up resistor this line needs.

Connect **data** to a digital pin, for example **D2**.`,
        fa: `DHT11 دما و رطوبت را روی تنها سیم **data** خودش به شکل رشته‌ای سریع از ۴۰ بیت می‌فرستد؛ حداکثر حدود یک بار در ثانیه. مقاومت بالاکشی که این خط لازم دارد روی خود ماژول هست.

**data** را به یک پایهٔ دیجیتال وصل کن، مثلاً **D2**.`,
      },
      checks: [{ kind: 'boardPin', pin: dht('data'), pinKind: 'digital' }],
    },
    {
      id: 'code',
      title: { en: 'Tell the sketch your pin', fa: 'پایه را به برنامه بگو' },
      body: {
        en: `Open the **Code** tab. Set \`DHT_PIN\` to the pin the sensor’s **data** wire goes to, for example \`const int DHT_PIN = 2;\`. The line \`DHT dht(DHT_PIN, DHT11);\` creates the sensor object on that pin.

Every 2 s, \`loop()\` asks for \`readTemperature()\` and \`readHumidity()\`. If the sensor did not answer, the result is “not a number” (\`isnan\`) and the sketch prints an error instead. Then a chain of \`if\` / \`else if\` picks one tip: above \`TOO_HOT_C\` (28 °C) it says **Too hot!**`,
        fa: `زبانهٔ **کد** را باز کن. \`DHT_PIN\` را پایه‌ای بگذار که سیم **data** سنسور به آن رفته، مثلاً \`const int DHT_PIN = 2;\`. خط \`DHT dht(DHT_PIN, DHT11);\` شیء سنسور را روی همان پایه می‌سازد.

\`loop()\` هر ۲ ثانیه \`readTemperature()\` و \`readHumidity()\` را می‌خواهد. اگر سنسور جواب ندهد، نتیجه «عدد نیست» (\`isnan\`) است و برنامه به جایش یک خطا چاپ می‌کند. بعد زنجیره‌ای از \`if\` / \`else if\` یک توصیه انتخاب می‌کند: بالاتر از \`TOO_HOT_C\` (۲۸ درجه) می‌گوید **Too hot!**`,
      },
      checks: [{ kind: 'code', use: 'dht', at: dht('data') }],
      solution: WEATHER_STATION_PINS,
    },
    {
      id: 'run',
      title: { en: 'Heat up the room', fa: 'اتاق را گرم کن' },
      body: {
        en: 'Press **Run** and open the **Serial Monitor**. After about 2 s you should see a line like **Temp: 24 C  Humidity: 55 %  Comfortable.** Now select the DHT11 while it runs and raise its temperature above 28 °C: the next reading should say **Too hot!**',
        fa: '**اجرا** را بزن و **مانیتور سریال** را باز کن. بعد از حدود ۲ ثانیه باید خطی مثل **Temp: 24 C  Humidity: 55 %  Comfortable.** ببینی. حالا در حین اجرا DHT11 را انتخاب کن و دمایش را بالای ۲۸ درجه ببر: خواندن بعدی باید **Too hot!** بگوید.',
      },
      checks: [{ kind: 'run' }],
      hints: {
        notRun: {
          en: 'Run it, wait for a reading, then raise the DHT11’s temperature above 28 °C. “Sensor error” means DHT_PIN does not match the pin the data wire goes to.',
          fa: 'اجرا کن، منتظر یک خواندن بمان، بعد دمای DHT11 را بالای ۲۸ درجه ببر. «Sensor error» یعنی DHT_PIN با پایه‌ای که سیم data به آن رفته جور نیست.',
        },
      },
    },
  ],
  starter,
  reference: finished(
    starter,
    [part('dht', DHT, g(32), g(16))],
    [
      ['board.5V', 'dht.vcc'],
      ['dht.data', 'board.D2'],
      ['dht.gnd', 'board.GND1'],
    ],
    WEATHER_STATION_SOLUTION_SKETCH,
  ),
  referenceInputs: [{ slice: 3000, componentId: 'dht', name: 'temperatureC', value: 32 }],
  assets: { wiring: WIRING_SVG },
};
