# IT-6 review — part functions (owner review, 2026-11-07)

Check: right functions per part? FA labels/synonyms natural? Anything missing or misleading? Per-part *why* marked ★.

## Parts → functions

| Part | Interfaces | Functions |
|---|---|---|
| 4×AA battery pack (`power.battery-4aa`) | — | Battery power / تغذیهٔ باتری |
| 9 V battery (`power.battery-9v`) | — | Battery power / تغذیهٔ باتری |
| BMP280 pressure + temperature sensor (`sensor.bmp280`) | i2c | Measure air pressure / اندازه‌گیری فشار هوا<br>Measure temperature / اندازه‌گیری دما ★ |
| Full breadboard (`passive.breadboard-full`) | — | Prototyping / نمونه‌سازی |
| Half breadboard (`passive.breadboard-half`) | — | Prototyping / نمونه‌سازی |
| Bump / limit switch (`sensor.bump-switch`) | digital | Detect collisions / تشخیص برخورد<br>Detect obstacles / تشخیص مانع ★ |
| Active buzzer (`actuator.buzzer-active`) | digital | Make a sound / تولید صدا |
| Passive buzzer (`actuator.buzzer-passive`) | pwm | Make a sound / تولید صدا<br>Play tones / پخش نت |
| Ceramic capacitor (`passive.capacitor-ceramic`) | — | Store energy / ذخیرهٔ انرژی<br>Smooth a supply / صاف کردن تغذیه |
| Electrolytic capacitor (`passive.capacitor-electrolytic`) | — | Smooth a supply / صاف کردن تغذیه<br>Store energy / ذخیرهٔ انرژی |
| 2WD robot chassis (`mechanical.chassis-2wd`) | — | Robot base / بدنهٔ ربات |
| CD4017 decade counter (`ic.cd4017`) | digital, pulse | Count pulses / شمارش پالس |
| DHT11 temperature + humidity sensor (`sensor.dht11`) | digital | Measure temperature / اندازه‌گیری دما<br>Measure humidity / اندازه‌گیری رطوبت |
| 1N4007 rectifier diode (`semiconductor.diode-1n4007`) | — | Block reverse current / جلوگیری از جریان معکوس<br>Flyback protection / محافظت هرزگرد |
| 1N4148 signal diode (`semiconductor.diode-1n4148`) | — | Block reverse current / جلوگیری از جریان معکوس<br>Flyback protection / محافظت هرزگرد ★ |
| 5.1 V Zener diode (`semiconductor.zener-5v1`) | — | Clamp a voltage / محدود کردن ولتاژ |
| DS18B20 digital thermometer (1-Wire) (`sensor.ds18b20`) | onewire | Measure temperature / اندازه‌گیری دما |
| HC-SR04 ultrasonic sensor (`sensor.hc-sr04`) | pulse | Measure distance / اندازه‌گیری فاصله<br>Detect obstacles / تشخیص مانع |
| FC-51 IR obstacle sensor (`sensor.ir-obstacle`) | digital | Detect obstacles / تشخیص مانع |
| IRF520 MOSFET module (`driver.irf520-module`) | digital, pwm | Switch a big load / کلیدزنی بار سنگین<br>Drive a DC motor / راه‌اندازی موتور DC ★ |
| KY-023 joystick (`sensor.joystick`) | analog, digital | Joystick input / ورودی جوی‌استیک<br>Button input / ورودی دکمه ★ |
| 4×4 keypad (`sensor.keypad-4x4`) | digital | Keypad input / ورودی کیپد |
| L298N motor driver (`driver.l298n`) | digital, pwm | Drive two motors / راه‌اندازی دو موتور<br>Drive a DC motor / راه‌اندازی موتور DC<br>Drive a stepper / راه‌اندازی استپر |
| L9110S motor driver (`driver.l9110s`) | digital, pwm | Drive two motors / راه‌اندازی دو موتور<br>Drive a DC motor / راه‌اندازی موتور DC |
| 16×2 LCD with I²C backpack (`display.lcd1602-i2c`) | i2c | Show text / نمایش متن<br>Show numbers / نمایش عدد |
| Light sensor (LDR) (`sensor.ldr`) | analog | Sense light / حس کردن نور |
| RGB LED (`actuator.led-rgb`) | pwm, digital | Show colours / نمایش رنگ<br>Status light / چراغ وضعیت |
| LED (`actuator.led`) | digital, pwm | Status light / چراغ وضعیت |
| 3-channel line sensor (`sensor.line-3ch`) | digital | Follow a line / دنبال کردن خط |
| 5-channel line sensor (`sensor.line-5ch`) | digital | Follow a line / دنبال کردن خط |
| AMS1117 3.3 V regulator (`semiconductor.ams1117-3v3`) | — | Make 3.3 V / ساخت ۳٫۳ ولت<br>Lower a voltage / کاهش ولتاژ |
| LM7805 5 V regulator (`semiconductor.lm7805`) | — | Make 5 V / ساخت ۵ ولت<br>Lower a voltage / کاهش ولتاژ |
| LM2596 buck converter (`power.lm2596`) | — | Lower a voltage / کاهش ولتاژ<br>Make 5 V / ساخت ۵ ولت ★ |
| 74HC00 quad NAND gate (`ic.74hc00`) | digital | Logic gates / گیت منطقی |
| 74HC08 quad AND gate (`ic.74hc08`) | digital | Logic gates / گیت منطقی |
| 74HC14 hex Schmitt inverter (`ic.74hc14`) | digital | Clean up a signal / تمیز کردن سیگنال<br>Logic gates / گیت منطقی |
| 74HC32 quad OR gate (`ic.74hc32`) | digital | Logic gates / گیت منطقی |
| 74HC86 quad XOR gate (`ic.74hc86`) | digital | Logic gates / گیت منطقی |
| MPU-6050 accelerometer + gyroscope (`sensor.mpu6050`) | i2c | Measure tilt / اندازه‌گیری شیب<br>Measure acceleration / اندازه‌گیری شتاب<br>Measure rotation / اندازه‌گیری چرخش |
| NE555 timer (`ic.ne555`) | pulse | Generate pulses / تولید پالس |
| SSD1306 OLED display (128×64, I²C) (`display.oled-ssd1306`) | i2c | Show graphics / نمایش گرافیک<br>Show text / نمایش متن<br>Show numbers / نمایش عدد |
| HC-SR501 PIR motion sensor (`sensor.pir`) | digital | Detect motion / تشخیص حرکت |
| Potentiometer (`passive.potentiometer`) | analog | Knob input / ورودی پیچ تنظیم<br>Divide a voltage / تقسیم ولتاژ |
| Push button (`sensor.push-button`) | digital | Button input / ورودی دکمه |
| Relay module (5 V, 1 channel) (`actuator.relay-module`) | digital | Isolate a load / ایزوله کردن بار<br>Switch a big load / کلیدزنی بار سنگین |
| Resistor (`passive.resistor`) | — | Limit current / محدود کردن جریان<br>Divide a voltage / تقسیم ولتاژ<br>Pull-up / pull-down / پول‌آپ / پول‌دان |
| KY-040 rotary encoder (`sensor.rotary-encoder`) | digital | Knob input / ورودی پیچ تنظیم<br>Measure rotation / اندازه‌گیری چرخش |
| MG996R servo (`actuator.mg996r-servo`) | pwm | Move to an angle / چرخش به زاویه |
| SG90 micro servo (`actuator.sg90-servo`) | pwm | Move to an angle / چرخش به زاویه |
| 7-segment display (1 digit) (`display.seven-segment`) | digital | Show numbers / نمایش عدد |
| 74HC595 shift register (`ic.74hc595`) | digital | More outputs / خروجی بیشتر |
| Soil moisture sensor (`sensor.soil-moisture`) | analog, digital | Measure soil moisture / اندازه‌گیری رطوبت خاک |
| KY-038 sound sensor (`sensor.sound`) | analog, digital | Detect sound / تشخیص صدا |
| 28BYJ-48 stepper motor (`actuator.stepper-28byj48`) | — | Rotate in steps / چرخش پله‌ای |
| On/off switch (`power.switch`) | — | Power switch / کلید روشن/خاموش |
| TB6612FNG motor driver (`driver.tb6612fng`) | digital, pwm | Drive two motors / راه‌اندازی دو موتور<br>Drive a DC motor / راه‌اندازی موتور DC<br>Drive a stepper / راه‌اندازی استپر |
| TCRT5000 line sensor (`sensor.tcrt5000`) | analog, digital | Follow a line / دنبال کردن خط<br>Detect obstacles / تشخیص مانع ★ |
| 2N2222 NPN transistor (`semiconductor.2n2222`) | digital, pwm | Switch a small load / کلیدزنی بار کوچک<br>Amplify / تقویت |
| 2N3906 PNP transistor (`semiconductor.2n3906`) | digital, pwm | Switch a small load / کلیدزنی بار کوچک<br>Amplify / تقویت |
| BC547 NPN transistor (`semiconductor.bc547`) | digital, pwm | Switch a small load / کلیدزنی بار کوچک<br>Amplify / تقویت |
| IRLZ44N logic-level MOSFET (`semiconductor.irlz44n`) | digital, pwm | Switch a big load / کلیدزنی بار سنگین |
| TIP120 Darlington transistor (`semiconductor.tip120`) | digital, pwm | Switch a big load / کلیدزنی بار سنگین<br>Amplify / تقویت ★ |
| TT gear motor (`actuator.tt-motor`) | — | Spin a wheel / چرخاندن چرخ |
| ULN2003A Darlington driver (`ic.uln2003a`) | digital | Drive a stepper / راه‌اندازی استپر<br>Switch a big load / کلیدزنی بار سنگین ★ |
| VL53L0X laser distance sensor (`sensor.vl53l0x`) | i2c | Measure distance / اندازه‌گیری فاصله<br>Detect obstacles / تشخیص مانع |
| WS2812B RGB LED strip (NeoPixel) (`actuator.ws2812-strip`) | digital | LED strip / نوار LED<br>Show colours / نمایش رنگ |

## Per-part why texts (★)

| Part | Function | EN | FA |
|---|---|---|---|
| BMP280 pressure + temperature sensor | measure-temperature | Mainly a pressure sensor; it also reads temperature. | اصلاً سنسور فشار است؛ دما را هم می‌خواند. |
| Bump / limit switch | detect-obstacle | Only once the robot touches it. | فقط وقتی ربات به آن بخورد. |
| 1N4148 signal diode | absorb-flyback | Fine for small relays; use a 1N4007 for motors. | برای رله‌های کوچک مناسب است؛ برای موتور از 1N4007 استفاده کنید. |
| IRF520 MOSFET module | drive-dc-motor | One direction only; speed by PWM. | فقط یک جهت؛ سرعت با PWM. |
| KY-023 joystick | user-input-button | Press the stick down. | اهرم را به پایین فشار دهید. |
| LM2596 buck converter | regulate-5v | Adjustable: set its output to 5 V. | قابل تنظیم: خروجی آن را روی ۵ ولت بگذارید. |
| TCRT5000 line sensor | detect-obstacle | Only at very short range (a few mm to ~2 cm). | فقط در فاصلهٔ خیلی کم (چند میلی‌متر تا حدود ۲ سانتی‌متر). |
| TIP120 Darlington transistor | amplify-signal | A Darlington pair: very high gain. | زوج دارلینگتون: بهرهٔ بسیار بالا. |
| ULN2003A Darlington driver | switch-high-current | Seven sink channels, up to 500 mA each. | هفت کانال سینک، هر کدام تا ۵۰۰ میلی‌آمپر. |

## Functions → synonyms (searched in both languages)

| Id | Label EN / FA | Generic why (FA) | EN synonyms | FA synonyms |
|---|---|---|---|---|
| `measure-distance` | Measure distance / اندازه‌گیری فاصله | فاصله تا نزدیک‌ترین جسم را گزارش می‌کند. | measure distance, distance sensor, range finder, how far, ultrasonic, time of flight, lidar | اندازه‌گیری فاصله, سنجش فاصله, سنسور فاصله, فاصله سنج, مسافت سنج, التراسونیک, اولتراسونیک, لیزری |
| `detect-obstacle` | Detect obstacles / تشخیص مانع | به ربات خبر می‌دهد چیزی سر راهش است. | detect obstacle, obstacle sensor, avoid obstacles, object detection, proximity | تشخیص مانع, سنسور مانع, دوری از مانع, تشخیص جسم, مجاورت |
| `detect-collision` | Detect collisions / تشخیص برخورد | وقتی ربات به چیزی بخورد، کنتاکت را می‌بندد. | detect collision, bump sensor, crash sensor, touch wall, limit switch | تشخیص برخورد, سنسور برخورد, سنسور ضربه, لیمیت سوییچ, میکروسوییچ |
| `follow-line` | Follow a line / دنبال کردن خط | خط تیره روی زمین روشن را می‌بیند تا ربات آن را دنبال کند. | follow line, line follower, line sensor, black line, line tracking, reflectance | دنبال کردن خط, تعقیب خط, مسیریاب, سنسور خط, خط سیاه, ردیاب خط, بازتاب |
| `measure-temperature` | Measure temperature / اندازه‌گیری دما | دما را بر حسب درجهٔ سلسیوس می‌خواند. | measure temperature, temperature sensor, thermometer, heat, temp | اندازه‌گیری دما, سنجش دما, سنسور دما, دماسنج, حرارت, دما |
| `measure-humidity` | Measure humidity / اندازه‌گیری رطوبت | رطوبت نسبی هوا را می‌خواند. | measure humidity, humidity sensor, air moisture, hygrometer | اندازه‌گیری رطوبت, سنسور رطوبت, رطوبت هوا, رطوبت سنج, نم هوا |
| `measure-pressure` | Measure air pressure / اندازه‌گیری فشار هوا | فشار هوا را می‌خواند که از آن ارتفاع هم به دست می‌آید. | measure pressure, air pressure, barometer, altitude, altimeter | اندازه‌گیری فشار, فشار هوا, فشارسنج, ارتفاع, ارتفاع سنج |
| `measure-soil-moisture` | Measure soil moisture / اندازه‌گیری رطوبت خاک | میزان خیسی خاک را برای پروژه‌های گیاه نشان می‌دهد. | measure soil moisture, soil moisture, plant watering, wet soil, dry soil | رطوبت خاک, سنسور رطوبت خاک, آبیاری گیاه, خاک خشک, گلدان |
| `sense-light` | Sense light / حس کردن نور | خوانش آن با میزان روشنایی تغییر می‌کند. | sense light, light sensor, brightness, day night, dark detection, photoresistor | حس نور, سنسور نور, تشخیص نور, روشنایی, شب و روز, تاریکی, فتوسل |
| `detect-motion` | Detect motion / تشخیص حرکت | حرکت انسان یا حیوان در نزدیکی را می‌فهمد. | detect motion, motion sensor, movement, presence, person detection, pir | تشخیص حرکت, سنسور حرکت, حضور, تشخیص انسان, دزدگیر |
| `detect-sound` | Detect sound / تشخیص صدا | به صداهای بلند مثل دست زدن واکنش نشان می‌دهد. | detect sound, sound sensor, microphone, clap, noise level | تشخیص صدا, سنسور صدا, میکروفون, دست زدن, سطح صدا |
| `measure-tilt` | Measure tilt / اندازه‌گیری شیب | نشان می‌دهد قطعه به کدام سمت کج شده است. | measure tilt, tilt sensor, angle sensor, orientation, balance, inclination | اندازه‌گیری شیب, سنسور شیب, زاویه, جهت گیری, تعادل, کج شدن |
| `measure-acceleration` | Measure acceleration / اندازه‌گیری شتاب | شتاب، لرزش و گرانش را اندازه می‌گیرد. | measure acceleration, accelerometer, shake, vibration, imu | اندازه‌گیری شتاب, شتاب سنج, لرزش, تکان |
| `measure-rotation` | Measure rotation / اندازه‌گیری چرخش | نشان می‌دهد چیزی چقدر یا با چه سرعتی می‌چرخد. | measure rotation, gyroscope, turn rate, count turns, rotation sensor | اندازه‌گیری چرخش, ژیروسکوپ, سرعت چرخش, شمارش دور, سنسور چرخش |
| `user-input-button` | Button input / ورودی دکمه | کاربر با فشار دادن آن فرمان می‌دهد. | button, push button, press, click, user input, tactile switch | دکمه, کلید فشاری, فشار دادن, ورودی کاربر, تک سوییچ |
| `user-input-knob` | Knob input / ورودی پیچ تنظیم | کاربر با چرخاندن آن مقداری را تنظیم می‌کند. | knob, dial, turn to adjust, set a value, volume control | پیچ تنظیم, ولوم, تنظیم مقدار, چرخاندن, دستگیره |
| `user-input-joystick` | Joystick input / ورودی جوی‌استیک | اهرم دومحوره برای هدایت یا بازی. | joystick, thumb stick, game controller, two axis input, remote control | جوی استیک, دسته بازی, کنترل دو محوره, کنترل دستی |
| `user-input-keypad` | Keypad input / ورودی کیپد | کاربر می‌تواند عدد و رمز وارد کند. | keypad, enter a code, password, number keys, pin code | کیپد, صفحه کلید, وارد کردن رمز, رمز, کلیدهای عددی |
| `drive-dc-motor` | Drive a DC motor / راه‌اندازی موتور DC | یک پایه می‌تواند سرعت و جهت موتور را کنترل کند. | drive motor, drive dc motor, motor driver, motor speed, motor direction, h bridge | راه اندازی موتور, درایور موتور, کنترل موتور, سرعت موتور, جهت موتور, پل اچ |
| `drive-two-dc-motors` | Drive two motors / راه‌اندازی دو موتور | دو کانال دارد: یکی برای هر چرخ. | drive two motors, two motors, dual motor driver, two wheels, both wheels, differential drive | راه اندازی دو موتور, دو موتور, درایور دو موتور, دو چرخ, هر دو چرخ, دو کاناله |
| `drive-stepper` | Drive a stepper / راه‌اندازی استپر | سیم‌پیچ‌های موتور پله‌ای را به ترتیب تغذیه می‌کند. | drive stepper, stepper driver, stepper motor driver | راه اندازی استپر, درایور استپر, درایور استپر موتور, راه اندازی موتور پله ای |
| `spin-wheel` | Spin a wheel / چرخاندن چرخ | موتور گیربکس‌دار که چرخ ربات را می‌چرخاند. | spin wheel, dc motor, gear motor, wheel motor, make it move, robot wheel | چرخاندن چرخ, موتور دی سی, موتور گیربکس, موتور چرخ, حرکت ربات, چرخ ربات |
| `move-to-angle` | Move to an angle / چرخش به زاویه | به زاویه‌ای که کد می‌خواهد می‌چرخد و همان‌جا می‌ماند. | move to angle, servo, rotate to position, robot arm, steering, gripper | چرخش به زاویه, سروو, سرو موتور, بازوی ربات, فرمان, گیره |
| `rotate-in-steps` | Rotate in steps / چرخش پله‌ای | با گام‌های دقیق می‌چرخد تا موقعیت دقیق بگیرد. | rotate in steps, stepper motor, precise rotation, exact position | چرخش پله ای, استپر موتور, موتور پله ای, چرخش دقیق, موقعیت دقیق |
| `show-text` | Show text / نمایش متن | کلمات و پیام‌ها را نشان می‌دهد. | show text, display text, screen, lcd, print message | نمایش متن, نمایشگر, صفحه نمایش, ال سی دی, نوشتن پیام |
| `show-number` | Show numbers / نمایش عدد | رقم‌هایی مثل شمارش یا مقدار خوانده‌شده را نشان می‌دهد. | show number, display digits, counter display, score display, clock digits | نمایش عدد, نمایش رقم, نمایشگر عدد, شمارنده, سون سگمنت, هفت قسمتی |
| `show-graphics` | Show graphics / نمایش گرافیک | پیکسل، شکل و نمودار ساده رسم می‌کند. | show graphics, draw shapes, pixel display, graph on screen, oled | نمایش گرافیک, رسم شکل, نمایشگر گرافیکی, نمودار روی صفحه, او ال ای دی |
| `show-status-light` | Status light / چراغ وضعیت | برای نشان دادن یک وضعیت روشن می‌شود. | status light, indicator, blink, light up, lamp | چراغ وضعیت, نشانگر, چشمک زن, روشن کردن چراغ, لامپ, ال ای دی |
| `show-colors` | Show colours / نمایش رنگ | قرمز، سبز و آبی را به هر رنگی ترکیب می‌کند. | show colors, rgb, mix colors, color light, rainbow | نمایش رنگ, رنگی, ترکیب رنگ, نور رنگی, رنگین کمان |
| `light-strip` | LED strip / نوار LED | تعداد زیادی LED که هر کدام جدا از یک پایه تنظیم می‌شود. | led strip, addressable leds, neopixel, light many leds, decoration lights | نوار ال ای دی, ریسه, نئوپیکسل, ال ای دی آدرس پذیر, نورپردازی |
| `make-sound` | Make a sound / تولید صدا | برای آژیر و هشدار بوق می‌زند. | make sound, beep, alarm, buzzer, alert | تولید صدا, بوق, آژیر, بیزر, هشدار, زنگ |
| `play-tone` | Play tones / پخش نت | فرکانس نتی را که کد انتخاب می‌کند پخش می‌کند. | play tone, play melody, music, notes, tone frequency | پخش نت, پخش آهنگ, موسیقی, ملودی, فرکانس صدا |
| `switch-high-current` | Switch a big load / کلیدزنی بار سنگین | یک پایه می‌تواند بارهایی را روشن کند که جریانشان از توان پایه بیشتر است. | switch high current, switch big load, power switch, control a pump, control a lamp, switch motor | کلید زنی جریان بالا, سوییچ بار سنگین, کنترل پمپ, کنترل لامپ, روشن خاموش کردن موتور, جریان زیاد |
| `switch-small-load` | Switch a small load / کلیدزنی بار کوچک | کلید ترانزیستوری برای LED، بیزر و رلهٔ کوچک. | switch small load, transistor switch, switch led, switch buzzer, low side switch | کلید زنی بار کوچک, ترانزیستور سوییچ, روشن کردن ال ای دی, کلید ترانزیستوری |
| `isolate-load` | Isolate a load / ایزوله کردن بار | مداری جدا را بدون اتصال الکتریکی به برد قطع و وصل می‌کند. | isolate load, relay, separate circuit, switch ac, mains appliance | ایزوله کردن بار, رله, مدار جدا, برق شهر, وسیله برقی |
| `amplify-signal` | Amplify / تقویت | یک جریان کوچک، جریان بسیار بزرگ‌تری را کنترل می‌کند. | amplify signal, amplifier, boost current, current gain | تقویت سیگنال, تقویت کننده, تقویت جریان, بهره جریان |
| `regulate-5v` | Make 5 V / ساخت ۵ ولت | از منبع بالاتر، ۵ ولت ثابت می‌دهد. | regulate 5v, 5v, 5 volt, five volts, 5v regulator, make 5v | تنظیم 5 ولت, 5 ولت, پنج ولت, رگولاتور 5 ولت, ساخت 5 ولت |
| `regulate-3v3` | Make 3.3 V / ساخت ۳٫۳ ولت | برای قطعه‌های ۳٫۳ ولتی، ۳٫۳ ولت ثابت می‌دهد. | regulate 3.3v, 3.3v, 3.3 volt, 3v3, 3.3v regulator | تنظیم 3.3 ولت, 3.3 ولت, سه و سه دهم ولت, رگولاتور 3.3 ولت |
| `step-down-voltage` | Lower a voltage / کاهش ولتاژ | منبع بالاتر را به ولتاژ پایین‌تر و ثابت تبدیل می‌کند. | step down voltage, lower voltage, voltage regulator, buck converter, reduce voltage | کاهش ولتاژ, پایین آوردن ولتاژ, رگولاتور ولتاژ, مبدل باک, تثبیت ولتاژ |
| `supply-battery-power` | Battery power / تغذیهٔ باتری | مدار را بدون کابل تغذیه می‌کند. | battery, power supply, portable power, power the robot, cells | باتری, منبع تغذیه, تغذیه, برق ربات, باتری قلمی, باطری |
| `switch-power` | Power switch / کلید روشن/خاموش | کل مدار را روشن و خاموش می‌کند. | switch power, on off switch, power switch, turn on, toggle switch | کلید روشن خاموش, کلید قطع و وصل, کلید برق, روشن کردن, کلید دو حالته |
| `store-energy` | Store energy / ذخیرهٔ انرژی | بار را نگه می‌دارد و بعداً آزاد می‌کند. | store energy, capacitor, charge storage, timing capacitor, decoupling | ذخیره انرژی, خازن, ذخیره بار, خازن زمان بندی, دکاپلینگ |
| `smooth-voltage` | Smooth a supply / صاف کردن تغذیه | افت و نویز خط تغذیه را جذب می‌کند. | smooth voltage, filter ripple, reduce noise, stabilize supply, filter capacitor | صاف کردن ولتاژ, فیلتر ریپل, کاهش نویز, پایدار کردن تغذیه, خازن صافی |
| `limit-current` | Limit current / محدود کردن جریان | جریان را به‌اندازهٔ امن پایین نگه می‌دارد، مثلاً برای LED. | limit current, resistor, current limiting, protect led, series resistor | محدود کردن جریان, مقاومت, محافظت ال ای دی, مقاومت سری |
| `divide-voltage` | Divide a voltage / تقسیم ولتاژ | کسری از یک ولتاژ می‌سازد، مثلاً برای خواندن با پایهٔ آنالوگ. | divide voltage, voltage divider, scale voltage, read battery voltage | تقسیم ولتاژ, تقسیم کننده ولتاژ, مقسم ولتاژ, خواندن ولتاژ باتری |
| `pull-up-input` | Pull-up / pull-down / پول‌آپ / پول‌دان | وقتی چیزی ورودی را نمی‌راند، به آن سطح مشخصی می‌دهد. | pull up, pull down, stop floating input, default level | پول آپ, پول دان, ورودی شناور, سطح پیش فرض |
| `block-reverse-current` | Block reverse current / جلوگیری از جریان معکوس | جریان را فقط در یک جهت عبور می‌دهد. | block reverse current, diode, one way current, reverse polarity protection, rectify | جلوگیری از جریان معکوس, دیود, جریان یک طرفه, محافظت از اتصال معکوس, یکسوسازی |
| `absorb-flyback` | Flyback protection / محافظت هرزگرد | ولتاژ ضربه‌ای هنگام خاموش شدن سیم‌پیچ یا موتور را جذب می‌کند. | flyback diode, protect from motor spikes, snubber, freewheeling diode, kickback | دیود هرزگرد, محافظت از ضربه موتور, دیود فلای بک, ولتاژ برگشتی |
| `clamp-voltage` | Clamp a voltage / محدود کردن ولتاژ | نمی‌گذارد ولتاژ از مقدار نامی‌اش بالاتر برود. | clamp voltage, zener, voltage reference, overvoltage protection | محدود کردن ولتاژ, زنر, ولتاژ مرجع, محافظت از اضافه ولتاژ |
| `logic-gate` | Logic gates / گیت منطقی | سیگنال‌های دیجیتال را با AND، OR، NOT یا XOR ترکیب می‌کند. | logic gate, and gate, or gate, nand, xor, not gate, boolean logic | گیت منطقی, گیت اند, گیت اور, نند, ایکس اور, گیت نات, منطق بولی |
| `clean-up-signal` | Clean up a signal / تمیز کردن سیگنال | لبهٔ کند یا پرنویز را به لبهٔ تیز تبدیل می‌کند. | clean up signal, schmitt trigger, debounce, square up, invert signal | تمیز کردن سیگنال, اشمیت تریگر, حذف لرزش کلید, معکوس کردن سیگنال |
| `expand-outputs` | More outputs / خروجی بیشتر | با ۳ پایه، ۸ خروجی را می‌راند. | expand outputs, more pins, shift register, many leds, save pins | افزایش خروجی, پایه بیشتر, شیفت رجیستر, ال ای دی های زیاد, صرفه جویی در پایه |
| `count-pulses` | Count pulses / شمارش پالس | با هر پالس یک خروجی جلو می‌رود. | count pulses, counter, sequence leds, chaser, decade counter | شمارش پالس, شمارنده, ترتیب ال ای دی, چراغ دنباله دار, شمارنده دهدهی |
| `generate-pulses` | Generate pulses / تولید پالس | بدون هیچ کدی سیگنال روشن/خاموش منظم می‌سازد. | generate pulses, timer, oscillator, blink without code, clock signal, pwm generator | تولید پالس, تایمر, نوسان ساز, چشمک زن بدون کد, سیگنال کلاک, تولید پی دبلیو ام |
| `prototype-connections` | Prototyping / نمونه‌سازی | قطعه‌ها را بدون لحیم به هم وصل می‌کند. | breadboard, prototype, connect parts, solderless, build a circuit | برد بورد, بردبورد, نمونه سازی, اتصال قطعات, بدون لحیم, ساخت مدار |
| `build-robot-base` | Robot base / بدنهٔ ربات | بدنه‌ای که برد، موتورها و سنسورها را حمل می‌کند. | robot chassis, robot base, robot car, body, frame | شاسی ربات, بدنه ربات, ماشین ربات, بدنه, اسکلت |

## Voltage chip data (added 2026-11-07, display only — never read by a model or safety rule)

| Key → chip | Parts and values (⚠ = please confirm) |
|---|---|
| `ratedVoltageV` → "≤ X V" | 2N2222 40, 2N3906 40, BC547 45, TIP120 60 (Vceo) · IRLZ44N 55 (Vdss) · IRF520 module 24 (module load spec) · 1N4007 1000, 1N4148 100 (VRRM) · L298N 35 (module Vs) · resistor 250 (¼ W carbon film) · potentiometer 50 ⚠ · push button 12 · keypad 24 · bump switch 125 ⚠ (AC rating) · on/off switch 250 ⚠ (AC rating) · electrolytic 16 (default variant) |
| `nominalVoltageV` → "X V" | 4×AA 6, 9 V battery 9, zener 5.1 |
| `forwardVoltageV` → "Vf X V" | LED 2.0 (red), 7-segment 2.0, RGB LED 3.2 ⚠ (green/blue; red 2.0) |
| none | breadboards, chassis |
