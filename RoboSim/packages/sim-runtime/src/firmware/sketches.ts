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
