// Arduino sketches of the built-in demos. `pnpm firmware:gen` compiles them with the build service
// (apps/compiler) into generated.ts; a compiler test fails if the two drift apart.
export const FIRMWARE_SKETCHES = {
  blink: `
void setup() { pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, !digitalRead(13)); delay(500); }`,
  button: `
void setup() { pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, !digitalRead(2)); }`,
  dimmer: `
void setup() { pinMode(6, OUTPUT); }
void loop() { analogWrite(6, analogRead(A0) / 4); }`,
  servo: `
#include <Servo.h>
Servo servo;
void setup() { servo.attach(9); }
void loop() { servo.writeMicroseconds(500 + 2 * analogRead(A0)); }`,
  serial: `
void setup() { Serial.begin(115200); Serial.println("RoboSim ready"); pinMode(13, OUTPUT); }
int n = 0;
unsigned long last = 0;
void loop() {
  if (millis() - last >= 1000) { last = millis(); Serial.print("tick "); Serial.println(n++ % 10); }
  if (Serial.available()) { Serial.write(toupper(Serial.read())); digitalWrite(13, !digitalRead(13)); }
}`,
  fighting: `
void setup() { pinMode(2, OUTPUT); pinMode(3, OUTPUT); digitalWrite(2, HIGH); digitalWrite(3, LOW); }
void loop() {}`,
  pinHigh: `
void setup() { pinMode(9, OUTPUT); digitalWrite(9, HIGH); }
void loop() {}`,
  floating: `
void setup() { pinMode(2, INPUT); pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, !digitalRead(2)); }`,
  rgbMelody: `
// RGB mood light: the knob on A0 walks the colour wheel on a common-cathode RGB LED (PWM on
// D9/D6/D5 — tone() takes Timer2, so D3/D11 cannot PWM). The button on D2 plays a melody on the
// passive buzzer on D8.
const int RED_PIN = 9;
const int GREEN_PIN = 6;
const int BLUE_PIN = 5;
const int BUTTON_PIN = 2;
const int BUZZER_PIN = 8;
const int MELODY[] = {262, 330, 392, 523}; // C4 E4 G4 C5

void setup() { pinMode(BUTTON_PIN, INPUT_PULLUP); }

void showHue(int hue) { // 0..767 around the colour wheel
  int r, g, b;
  if (hue < 256) { r = 255 - hue; g = hue; b = 0; }
  else if (hue < 512) { r = 0; g = 511 - hue; b = hue - 256; }
  else { r = hue - 512; g = 0; b = 767 - hue; }
  analogWrite(RED_PIN, r);
  analogWrite(GREEN_PIN, g);
  analogWrite(BLUE_PIN, b);
}

void loop() {
  showHue(map(analogRead(A0), 0, 1023, 0, 767));
  if (digitalRead(BUTTON_PIN) == LOW) {
    for (int i = 0; i < 4; i++) { tone(BUZZER_PIN, MELODY[i], 150); delay(200); }
  }
}`,
  relayCounter: `
// Press the button on A1 to count 0-9 on a common-cathode 7-segment digit (a..g on D2..D8).
// On even numbers the relay on D12 switches the 9 V lamp circuit (LM7805 -> LED) on.
const int SEGMENT_PINS[7] = {2, 3, 4, 5, 6, 7, 8};
const byte DIGITS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F}; // bit 0 = a
const int BUTTON_PIN = A1;
const int RELAY_PIN = 12;
int count = 0;
bool wasPressed = false;

void show(int n) {
  for (int s = 0; s < 7; s++) digitalWrite(SEGMENT_PINS[s], bitRead(DIGITS[n], s));
  digitalWrite(RELAY_PIN, n % 2 == 0 ? HIGH : LOW);
}

void setup() {
  for (int s = 0; s < 7; s++) pinMode(SEGMENT_PINS[s], OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  show(count);
}

void loop() {
  bool pressed = digitalRead(BUTTON_PIN) == LOW;
  if (pressed && !wasPressed) { count = (count + 1) % 10; show(count); delay(20); }
  wasPressed = pressed;
}`,
  halfAdder: `
// Half adder in hardware: a 74HC86 XOR makes the sum, a 74HC08 AND the carry, straight from the two
// buttons. The Uno only reads the result (sum on D2, carry on D3) and prints it when it changes.
int last = -1;

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT);
  pinMode(3, INPUT);
}

void loop() {
  int sum = digitalRead(2);
  int carry = digitalRead(3);
  int now = carry * 2 + sum;
  if (now != last) {
    Serial.print("carry=");
    Serial.print(carry);
    Serial.print(" sum=");
    Serial.println(sum);
    last = now;
  }
}`,
  ledBar: `
// Knight Rider: one lit LED sweeps across 8 LEDs on a 74HC595. shiftOut() clocks each pattern into
// the shift register, the latch pin copies it to the outputs, and the knob on A0 sets the speed.
const int DATA_PIN = 11;
const int CLOCK_PIN = 12;
const int LATCH_PIN = 8;

void setup() {
  pinMode(DATA_PIN, OUTPUT);
  pinMode(CLOCK_PIN, OUTPUT);
  pinMode(LATCH_PIN, OUTPUT);
}

void show(byte pattern) {
  digitalWrite(LATCH_PIN, LOW);
  shiftOut(DATA_PIN, CLOCK_PIN, MSBFIRST, pattern);
  digitalWrite(LATCH_PIN, HIGH);
}

void loop() {
  for (int i = 0; i < 14; i++) {
    int pos = i < 8 ? i : 14 - i;
    show(1 << pos);
    delay(map(analogRead(A0), 0, 1023, 20, 300));
  }
}`,
  stepperKnob: `
// The 28BYJ-48 output shaft follows the knob: one knob turn = one shaft turn (2048 steps).
// The Stepper library energises the ULN2003A inputs IN1..IN4 on D8..D11 in the order IN1, IN3, IN2, IN4.
#include <Stepper.h>
const int STEPS_PER_TURN = 2048;
Stepper stepper(STEPS_PER_TURN, 8, 10, 9, 11);
int previous = 0;

void setup() { stepper.setSpeed(12); }

void loop() {
  int target = map(analogRead(A0), 0, 1023, 0, STEPS_PER_TURN);
  stepper.step(target - previous);
  previous = target;
}`,
  motorDriver: `
// Two TT motors on a TB6612FNG, powered from 4xAA. STBY (D7) must be HIGH or the driver sleeps.
// Motor A: PWMA D5, AIN1 D4, AIN2 D2. Motor B: PWMB D6, BIN1 D8, BIN2 D9. The speeds ramp in opposite
// directions, from full reverse to full forward.
const int STBY = 7;

void drive(int pwm, int in1, int in2, int speed) { // speed -255..255
  digitalWrite(in1, speed > 0 ? HIGH : LOW);
  digitalWrite(in2, speed < 0 ? HIGH : LOW);
  analogWrite(pwm, abs(speed));
}

void setup() {
  for (int p = 2; p <= 9; p++) pinMode(p, OUTPUT);
  digitalWrite(STBY, HIGH);
}

void loop() {
  for (int s = -255; s <= 255; s += 5) {
    drive(5, 4, 2, s);
    drive(6, 8, 9, -s);
    delay(40);
  }
}`,
  keypadLock: `
// Keypad door lock with the Keypad library: type 1234 then # to unlock (green LED on D12).
// * clears what you typed. Rows R1-R4 on D9..D6, columns C1-C4 on D5..D2.
#include <Keypad.h>
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
String typed = "";

void setup() {
  Serial.begin(9600);
  pinMode(12, OUTPUT);
  Serial.println("Enter code, then #");
}

void loop() {
  char key = keypad.getKey();
  if (!key) return;
  Serial.print(key);
  if (key == '*') {
    typed = "";
    digitalWrite(12, LOW);
    Serial.println();
  } else if (key == '#') {
    bool ok = typed == "1234";
    digitalWrite(12, ok ? HIGH : LOW);
    Serial.println(ok ? " unlocked" : " wrong code");
    typed = "";
  } else {
    typed += key;
  }
}`,
  inputDevices: `
// Input devices: a KY-040 rotary encoder counts detents (CLK D2, DT D3, push D4) and a KY-023 joystick
// reads two potentiometers (A0, A1) and its push switch (D5). Changes print to the serial monitor.
int count = 0;
int lastClk = HIGH;
int lastX = -1;
int lastY = -1;

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT); // the encoder board has its own pull-ups on CLK and DT
  pinMode(3, INPUT);
  pinMode(4, INPUT_PULLUP);
  pinMode(5, INPUT_PULLUP);
}

void loop() {
  int clk = digitalRead(2);
  if (clk != lastClk && clk == LOW) {
    count += digitalRead(3) == HIGH ? 1 : -1; // DT still HIGH: CLK led, clockwise
    Serial.print("count ");
    Serial.println(count);
  }
  lastClk = clk;
  if (digitalRead(4) == LOW) count = 0;

  int x = analogRead(A0) / 64; // 16 steps per axis, so small jitter does not flood the monitor
  int y = analogRead(A1) / 64;
  if (x != lastX || y != lastY) {
    Serial.print("x ");
    Serial.print(x);
    Serial.print(" y ");
    Serial.print(y);
    Serial.println(digitalRead(5) == LOW ? " pressed" : "");
    lastX = x;
    lastY = y;
  }
}`,
  bumpAvoider: `
// Bump-and-turn obstacle avoider: three lever switches across the front (left D2, centre D4, right D3;
// NO to the pin, COM to GND, INPUT_PULLUP). After a bump the robot backs up and turns away; once clear
// for a while it turns back by the amount it turned, so it keeps heading for the goal.
// L298N: ENA D5, ENB D6, IN1-IN4 D7-D10.
const int SPEED = 200;
const int TURN_MS = 300;
long heading = 0; // net spin time in ms, right positive
unsigned long clearSince = 0;

void drive(int left, int right) { // -255..255
  digitalWrite(7, left > 0 ? HIGH : LOW);
  digitalWrite(8, left < 0 ? HIGH : LOW);
  analogWrite(5, abs(left));
  digitalWrite(9, right > 0 ? HIGH : LOW);
  digitalWrite(10, right < 0 ? HIGH : LOW);
  analogWrite(6, abs(right));
}

void spin(int dir, int ms) { // dir 1 = right
  drive(dir * SPEED, -dir * SPEED);
  delay(ms);
  heading += dir * ms;
}

void setup() {
  for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT);
  pinMode(2, INPUT_PULLUP);
  pinMode(3, INPUT_PULLUP);
  pinMode(4, INPUT_PULLUP);
}

void loop() {
  bool left = digitalRead(2) == LOW;
  bool right = digitalRead(3) == LOW;
  bool centre = digitalRead(4) == LOW;
  if (left || right || centre) {
    drive(-SPEED, -SPEED);
    delay(250);
    // Turn away from the side that hit; head-on, turn back toward the goal heading.
    int dir = left ? 1 : right ? -1 : (heading > 0 ? -1 : 1);
    spin(dir, TURN_MS);
    clearSince = millis();
  } else if (heading != 0 && millis() - clearSince > 1200) {
    long back = constrain(-heading, -TURN_MS, TURN_MS);
    spin(back > 0 ? 1 : -1, abs(back));
    clearSince = millis();
  } else {
    drive(SPEED, SPEED);
  }
}`,
  timer555: `
// 555 blinker: the NE555 runs on its own as an astable (R1 = 1 kΩ, R2 = 68 kΩ, C = 10 µF, about 1 Hz)
// and blinks the LED. The Uno only watches the 555's output on D2 and reports what it measures.
const int TIMER_PIN = 2;

void setup() {
  Serial.begin(9600);
  pinMode(TIMER_PIN, INPUT);
}

void loop() {
  unsigned long high = pulseIn(TIMER_PIN, HIGH, 3000000UL); // µs
  unsigned long low = pulseIn(TIMER_PIN, LOW, 3000000UL);
  if (high == 0 || low == 0) {
    Serial.println("no pulses");
    return;
  }
  Serial.print("period ");
  Serial.print((high + low) / 1000);
  Serial.print(" ms, high ");
  Serial.print(100 * high / (high + low));
  Serial.println(" %");
}`,
  rcCharge: `
// RC charging: D7 charges a 100 µF capacitor through 10 kΩ (time constant R·C = 1 s) and A0 reads its
// voltage. Every 4 s the pin flips, so the capacitor charges and discharges along e^(-t/RC) curves.
// Open the serial monitor (or plotter): after 1 s of charging it reads 63 % of 5 V.
const int CHARGE_PIN = 7;
unsigned long flipped = 0;
bool charging = true;

void setup() {
  Serial.begin(115200);
  pinMode(CHARGE_PIN, OUTPUT);
  digitalWrite(CHARGE_PIN, HIGH);
}

void loop() {
  if (millis() - flipped >= 4000) {
    flipped = millis();
    charging = !charging;
    digitalWrite(CHARGE_PIN, charging ? HIGH : LOW);
  }
  float volts = analogRead(A0) * 5.0 / 1023;
  Serial.println(volts, 2);
  delay(100);
}`,
  transistorMotor: `
// Motor speed with a TIP120: the knob on A0 sets the PWM duty on D9. D9 drives the TIP120's base
// through 1 kΩ, and the Darlington switches the motor current from the 4×AA pack, which no pin could
// supply. The 1N4007 across the motor carries the coil's current each time the transistor switches off.
const int MOTOR_PIN = 9;
unsigned long last = 0;

void setup() {
  Serial.begin(9600);
  pinMode(MOTOR_PIN, OUTPUT);
}

void loop() {
  int duty = analogRead(A0) / 4;
  analogWrite(MOTOR_PIN, duty);
  if (millis() - last >= 500) {
    last = millis();
    Serial.print("duty ");
    Serial.print(100L * duty / 255);
    Serial.println(" %");
  }
}`,
  mosfetRamp: `
// Soft start with a logic-level MOSFET: D6 drives an IRLZ44N's gate through 220 Ω, and 10 kΩ holds the
// gate low while the Uno boots. The motor ramps up over 2 s, runs, ramps down, rests, and repeats.
const int GATE_PIN = 6;

void setup() {
  Serial.begin(9600);
  pinMode(GATE_PIN, OUTPUT);
}

void ramp(int from, int to) {
  int step = from < to ? 5 : -5;
  for (int duty = from; duty != to; duty += step) {
    analogWrite(GATE_PIN, duty);
    delay(40);
  }
  analogWrite(GATE_PIN, to);
}

void loop() {
  Serial.println("ramp up");
  ramp(0, 255);
  Serial.println("full speed");
  delay(1500);
  Serial.println("ramp down");
  ramp(255, 0);
  Serial.println("rest");
  delay(1000);
}`,
  motorPwm: `
void setup() { pinMode(9, OUTPUT); analogWrite(9, 128); }
void loop() {}`,
  oledKnob: `
// SSD1306 OLED on I²C (SDA A4, SCL A5, address 0x3C): a title, the knob on A0 as a number and a bar.
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(9600);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 not found");
    for (;;) {}
  }
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  int knob = analogRead(A0);
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.println("RoboSim");
  display.setTextSize(1);
  display.setCursor(0, 24);
  display.print("Knob: ");
  display.println(knob);
  display.drawRect(0, 40, 128, 14, SSD1306_WHITE);
  display.fillRect(2, 42, map(knob, 0, 1023, 0, 124), 10, SSD1306_WHITE);
  display.display();
  delay(100);
}`,
  lcdHello: `
// 16x2 LCD with a PCF8574 I²C backpack (address 0x27): a greeting with a custom heart, then the uptime.
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
byte heart[8] = {0b00000, 0b01010, 0b11111, 0b11111, 0b01110, 0b00100, 0b00000, 0b00000};

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.createChar(0, heart);
  lcd.setCursor(0, 0);
  lcd.print("Hello, RoboSim ");
  lcd.write(0);
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print("Uptime: ");
  lcd.print(millis() / 1000);
  lcd.print(" s   ");
  delay(250);
}`,
  imuTilt: `
// MPU-6050 (I²C 0x68): prints acceleration and rotation, and lights the LED on D13 past 20° of tilt.
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

Adafruit_MPU6050 mpu;

void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  if (!mpu.begin()) {
    Serial.println("MPU6050 not found");
    for (;;) {}
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_2_G);
  mpu.setGyroRange(MPU6050_RANGE_250_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
}

void loop() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);
  float tilt = degrees(atan2(sqrt(a.acceleration.x * a.acceleration.x + a.acceleration.y * a.acceleration.y),
                             a.acceleration.z));
  digitalWrite(13, tilt > 20 ? HIGH : LOW);
  Serial.print("tilt ");
  Serial.print(tilt, 1);
  Serial.print(" deg, turn ");
  Serial.print(degrees(g.gyro.z), 1);
  Serial.println(" deg/s");
  delay(500);
}`,
  weatherStation: `
// BMP280 weather station on the 3.3 V pin (I²C 0x76): temperature, pressure and altitude every 2 s.
#include <Wire.h>
#include <Adafruit_BMP280.h>

Adafruit_BMP280 bmp;

void setup() {
  Serial.begin(9600);
  if (!bmp.begin(0x76)) {
    Serial.println("BMP280 not found");
    for (;;) {}
  }
  // Wire.begin() turned on the Uno's pull-ups to 5 V; the module already pulls SDA/SCL up to 3.3 V.
  digitalWrite(SDA, LOW);
  digitalWrite(SCL, LOW);
  bmp.setSampling(Adafruit_BMP280::MODE_NORMAL, Adafruit_BMP280::SAMPLING_X2, Adafruit_BMP280::SAMPLING_X16,
                  Adafruit_BMP280::FILTER_X16, Adafruit_BMP280::STANDBY_MS_500);
}

void loop() {
  Serial.print(bmp.readTemperature(), 1);
  Serial.print(" C  ");
  Serial.print(bmp.readPressure() / 100.0, 1);
  Serial.print(" hPa  ");
  Serial.print(bmp.readAltitude(1013.25), 0);
  Serial.println(" m");
  delay(2000);
}`,
  laserAvoider: `
// Laser-ranging obstacle avoider: a VL53L0X on the front (I²C, XSHUT to D11) measures the gap ahead.
// Something within 45 cm: veer right; within 18 cm: back up and turn. With a clear view it veers back
// left until it has undone its turns, so it keeps heading for the goal on the right of the course.
// L298N: ENA D5, ENB D6, IN1-IN4 D7-D10.
#include <Wire.h>
#include <VL53L0X.h>

VL53L0X tof;
const int SPEED = 170;
long heading = 0; // net turning, in ms of veering (right positive)
unsigned long last = 0;

void drive(int left, int right) { // -255..255
  digitalWrite(7, left > 0 ? HIGH : LOW);
  digitalWrite(8, left < 0 ? HIGH : LOW);
  analogWrite(5, abs(left));
  digitalWrite(9, right > 0 ? HIGH : LOW);
  digitalWrite(10, right < 0 ? HIGH : LOW);
  analogWrite(6, abs(right));
}

void setup() {
  Serial.begin(9600);
  for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT);
  pinMode(11, OUTPUT);
  digitalWrite(11, HIGH); // release XSHUT
  delay(10);
  Wire.begin();
  tof.setTimeout(500);
  if (!tof.init()) {
    Serial.println("VL53L0X not found");
    for (;;) {}
  }
  tof.startContinuous();
  last = millis();
}

void loop() {
  int mm = tof.readRangeContinuousMillimeters();
  unsigned long now = millis();
  int dt = now - last;
  last = now;
  if (mm < 180) {
    drive(-SPEED, -SPEED);
    delay(200);
    drive(SPEED, -SPEED);
    delay(250);
    heading += 500;
  } else if (mm < 450) {
    drive(SPEED, SPEED / 5); // veer right
    heading += dt;
  } else if (heading > 0 && mm > 600) {
    drive(SPEED / 5, SPEED); // veer back left
    heading -= dt;
  } else {
    drive(SPEED, SPEED);
  }
}`,
  mazeSolver: `
// Maze solver: right-hand wall follower, one 45 cm cell at a time. Three HC-SR04s (NewPing) look ahead
// (D2/D3), left (D4/D11) and right (A0/A1). In the middle of each cell it turns right if it can, else
// goes straight, else left, else turns around. Between cells it steers off the side walls, and the front
// sonar works as its odometer: a cell is done when the wall ahead is 45 cm closer.
// L298N: ENA D5, ENB D6, IN1-IN4 D7-D10.
#include <NewPing.h>

NewPing front(2, 3, 200);
NewPing left(4, 11, 200);
NewPing right(A0, A1, 200);

const int SPEED = 110;
const int TURN_SPEED = 120;
const int CELL_MM = 450;
const int SIDE_MM = 150;  // side wall distance when centred in a corridor
const int OPEN_MM = 300;  // farther than this: no wall on that side
const int STOP_MM = 155;  // the wall ahead when the robot is in the middle of the cell
const int TURN_90_MS = 370;
const int CELL_MS = 1750; // one cell without a wall ahead to measure against

int mm(NewPing &sonar) {
  unsigned int us = sonar.ping();
  return us == 0 ? 2000 : us * 10L / US_ROUNDTRIP_CM; // no echo: nothing within range
}

void drive(int l, int r) { // -255..255
  digitalWrite(7, l > 0 ? HIGH : LOW);
  digitalWrite(8, l < 0 ? HIGH : LOW);
  analogWrite(5, abs(l));
  digitalWrite(9, r > 0 ? HIGH : LOW);
  digitalWrite(10, r < 0 ? HIGH : LOW);
  analogWrite(6, abs(r));
}

void brake() { // enables on, inputs low: the L298N shorts the motors and they stop at once
  drive(0, 0);
  analogWrite(5, 255);
  analogWrite(6, 255);
  delay(150);
}

void turn(int dir, int ms) { // dir 1 = right
  drive(dir * TURN_SPEED, -dir * TURN_SPEED);
  delay(ms);
  brake();
}

// One cell ahead, steering to the middle between the side walls (or off the one wall there is).
void step() {
  int ahead = mm(front);
  int target = ahead < 1800 ? max(ahead - CELL_MM, STOP_MM) : 0;
  unsigned long end = millis() + CELL_MS;
  int last = 0;
  for (;;) {
    int f = mm(front);
    if (f <= STOP_MM || (target > 0 ? f <= target : millis() >= end)) break;
    int l = mm(left);
    int r = mm(right);
    int err = 0; // positive: too far left
    if (l < OPEN_MM && r < OPEN_MM) err = (r - l) / 2;
    else if (r < OPEN_MM) err = r - SIDE_MM;
    else if (l < OPEN_MM) err = SIDE_MM - l;
    int steer = constrain(err / 4 + (err - last), -40, 40);
    last = err;
    drive(SPEED + steer, SPEED - steer);
  }
  brake();
}

void setup() {
  Serial.begin(9600);
  for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT);
  delay(500);
}

void loop() {
  if (mm(right) > OPEN_MM) {
    Serial.println("right");
    turn(1, TURN_90_MS);
  } else if (mm(front) > OPEN_MM) {
    Serial.println("ahead");
  } else if (mm(left) > OPEN_MM) {
    Serial.println("left");
    turn(-1, TURN_90_MS);
  } else {
    Serial.println("back");
    turn(1, 2 * TURN_90_MS);
  }
  step();
}`,
  sumoBot: `
// Sumo bot: an HC-SR04 (NewPing, D2/D3) finds the opponent and the 3-channel line sensor (D11, D12,
// A0; HIGH over the black ring, LOW over the white edge) keeps the robot in the ring. It turns slowly
// to search and charges anything within 85 cm. Seen from the middle of the ring, the opponent is always
// that close and the arena walls are farther, so after backing off the edge it heads for the middle.
// Pressed against the opponent the echo is too close to measure, so it keeps pushing for a moment.
// L298N: ENA D5, ENB D6, IN1-IN4 D7-D10.
#include <NewPing.h>

NewPing sonar(2, 3, 120);
const int SEE_CM = 85;
const int CHARGE = 255;
const int SEARCH = 100;
unsigned long seen = 0; // when the opponent was last in sight

void drive(int l, int r) { // -255..255
  digitalWrite(7, l > 0 ? HIGH : LOW);
  digitalWrite(8, l < 0 ? HIGH : LOW);
  analogWrite(5, abs(l));
  digitalWrite(9, r > 0 ? HIGH : LOW);
  digitalWrite(10, r < 0 ? HIGH : LOW);
  analogWrite(6, abs(r));
}

bool onEdge() {
  return digitalRead(11) == LOW || digitalRead(12) == LOW || digitalRead(A0) == LOW;
}

void setup() {
  Serial.begin(9600);
  for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT);
  pinMode(11, INPUT);
  pinMode(12, INPUT);
  pinMode(A0, INPUT);
  delay(1000); // the start signal
}

void loop() {
  if (onEdge()) {
    Serial.println("edge");
    drive(-CHARGE, -CHARGE); // back off the edge,
    delay(250);
    drive(150, -150); // turn around
    delay(550);
    drive(180, 180); // and head for the middle
    for (int i = 0; i < 60 && !onEdge(); i++) delay(10);
    return;
  }
  int d = sonar.ping_cm();
  if (d > 0 && d < SEE_CM) seen = millis();
  // Pressed against the opponent the echo is too close to measure (under 2 cm): keep pushing.
  if (seen > 0 && millis() - seen < 400) {
    drive(CHARGE, CHARGE);
  } else {
    drive(SEARCH, -SEARCH);
  }
}`,
  thermometers: `
// Two thermometers: a DHT11 module on D2 (temperature + humidity) and a DS18B20 on D4 (1-Wire, with a
// 4.7 kΩ pull-up). Both are read every 2 s and printed to the serial monitor.
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>

DHT dht(2, DHT11);
OneWire oneWire(4);
DallasTemperature sensors(&oneWire);

void setup() {
  Serial.begin(9600);
  dht.begin();
  sensors.begin();
  Serial.print(sensors.getDeviceCount());
  Serial.println(" DS18B20 found");
}

void loop() {
  delay(2000);
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("DHT11 read failed");
  } else {
    Serial.print("DHT11 ");
    Serial.print(temperature, 0);
    Serial.print(" C ");
    Serial.print(humidity, 0);
    Serial.println(" %");
  }
  sensors.requestTemperatures();
  Serial.print("DS18B20 ");
  Serial.print(sensors.getTempCByIndex(0), 2);
  Serial.println(" C");
}`,
  neopixelRainbow: `
// NeoPixel rainbow: 8 WS2812B LEDs on D6 (through 330 Ω) cycle through the colour wheel; the knob on
// A0 sets the brightness.
#include <Adafruit_NeoPixel.h>

const int LEDS = 8;
Adafruit_NeoPixel strip(LEDS, 6, NEO_GRB + NEO_KHZ800);
uint16_t hue = 0;

void setup() {
  strip.begin();
  strip.show();
}

void loop() {
  strip.setBrightness(map(analogRead(A0), 0, 1023, 5, 255));
  for (int i = 0; i < LEDS; i++)
    strip.setPixelColor(i, strip.gamma32(strip.ColorHSV(hue + i * (65536L / LEDS))));
  strip.show();
  hue += 512;
  delay(20);
}`,
  lineFollower: `
// L/C/R line sensor on D2/D3/D4 (HIGH = black); L298N ENA/ENB on D5/D6, IN1-IN4 on D7-D10 (IN2/IN4 stay LOW).
void setup() {
  for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT);
  analogWrite(5, 150); analogWrite(6, 150);
}
void loop() {
  if (digitalRead(2)) { digitalWrite(7, LOW); digitalWrite(9, HIGH); }        // line on the left: turn left
  else if (digitalRead(4)) { digitalWrite(7, HIGH); digitalWrite(9, LOW); }   // on the right: turn right
  else if (digitalRead(3)) { digitalWrite(7, HIGH); digitalWrite(9, HIGH); }  // centred: straight
}`,
} as const;

export type FirmwareId = keyof typeof FIRMWARE_SKETCHES;
