// Guided projects' sketches (FR-LRN-01): what the learner starts from and the reference solution.
// Plain data (no imports): `pnpm firmware:gen` compiles the solutions into generated.ts, which the
// guided-project tests grade; a compiler test fails if the two drift apart.

/** What the learner completes: the pin numbers are theirs to fill in. */
export const LINE_FOLLOWER_STARTER_SKETCH = `
// Line follower: three sensors steer two motors through the L298N.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int ENA = 0;    // left motor speed (a PWM pin ~)
const int IN1 = 0;    // left motor direction
const int IN2 = 0;
const int ENB = 0;    // right motor speed (a PWM pin ~)
const int IN3 = 0;    // right motor direction
const int IN4 = 0;
const int LEFT = 0;   // line sensor outputs: HIGH over the black line
const int CENTER = 0;
const int RIGHT = 0;
const int SPEED = 150;  // 0-255

void setup() {
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(LEFT, INPUT); pinMode(CENTER, INPUT); pinMode(RIGHT, INPUT);
  digitalWrite(IN2, LOW);
  digitalWrite(IN4, LOW);
  analogWrite(ENA, SPEED);
  analogWrite(ENB, SPEED);
}

// Each motor either drives forward or stops.
void drive(bool left, bool right) {
  digitalWrite(IN1, left ? HIGH : LOW);
  digitalWrite(IN3, right ? HIGH : LOW);
}

void loop() {
  if (digitalRead(LEFT)) drive(false, true);        // line under the left sensor: turn left
  else if (digitalRead(RIGHT)) drive(true, false);  // under the right one: turn right
  else if (digitalRead(CENTER)) drive(true, true);  // centred: straight on
}
`;

export const LINE_FOLLOWER_PINS = `const int ENA = 5;    // left motor speed (a PWM pin ~)
const int IN1 = 7;    // left motor direction
const int IN2 = 8;
const int ENB = 6;    // right motor speed (a PWM pin ~)
const int IN3 = 9;    // right motor direction
const int IN4 = 10;
const int LEFT = 2;   // line sensor outputs: HIGH over the black line
const int CENTER = 3;
const int RIGHT = 4;`;

export const LINE_FOLLOWER_SOLUTION_SKETCH = LINE_FOLLOWER_STARTER_SKETCH.replace(
  /\/\/ TODO[^\n]*\n[\s\S]*?const int RIGHT = 0;/,
  LINE_FOLLOWER_PINS,
);

export const OBSTACLE_AVOIDER_STARTER_SKETCH = `
// Obstacle avoider: an HC-SR04 sonar looks ahead. The robot veers round anything in its way, backs off
// when something is too close, and turns back afterwards so it keeps heading for the goal.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int ENA = 0;    // left motor speed (a PWM pin ~)
const int IN1 = 0;    // left motor direction
const int IN2 = 0;
const int ENB = 0;    // right motor speed (a PWM pin ~)
const int IN3 = 0;    // right motor direction
const int IN4 = 0;
const int TRIG = 0;   // sonar trigger
const int ECHO = 0;   // sonar echo
// TODO: how close (in cm) may an obstacle get before the robot backs off?
const int TOO_CLOSE = 0;
const int SPEED = 170;  // 0-255

long heading = 0;  // how far the robot has turned right, in ms of veering
unsigned long last = 0;

void drive(int left, int right) {  // -255..255
  digitalWrite(IN1, left > 0 ? HIGH : LOW);
  digitalWrite(IN2, left < 0 ? HIGH : LOW);
  analogWrite(ENA, abs(left));
  digitalWrite(IN3, right > 0 ? HIGH : LOW);
  digitalWrite(IN4, right < 0 ? HIGH : LOW);
  analogWrite(ENB, abs(right));
}

// The sonar sends a click and times its echo: sound needs 58 microseconds per cm there and back.
long distanceCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);
  return us == 0 ? 500 : us / 58;  // no echo: nothing in range
}

void setup() {
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  last = millis();
}

void loop() {
  long cm = distanceCm();
  unsigned long now = millis();
  long dt = now - last;
  last = now;
  if (cm < TOO_CLOSE) {               // too close: back up and turn right
    drive(-SPEED, -SPEED);
    delay(200);
    drive(SPEED, -SPEED);
    delay(250);
    heading += 500;
  } else if (cm < TOO_CLOSE * 5 / 2) {  // something ahead: veer right
    drive(SPEED, SPEED / 5);
    heading += dt;
  } else if (heading > 0 && cm > TOO_CLOSE * 10 / 3) {  // clear: veer back left
    drive(SPEED / 5, SPEED);
    heading -= dt;
  } else {
    drive(SPEED, SPEED);
  }
}
`;

export const OBSTACLE_AVOIDER_PINS = `const int ENA = 5;    // left motor speed (a PWM pin ~)
const int IN1 = 7;    // left motor direction
const int IN2 = 8;
const int ENB = 6;    // right motor speed (a PWM pin ~)
const int IN3 = 9;    // right motor direction
const int IN4 = 10;
const int TRIG = 12;  // sonar trigger
const int ECHO = 11;  // sonar echo`;
export const OBSTACLE_AVOIDER_DISTANCE = 'const int TOO_CLOSE = 25;';

export const OBSTACLE_AVOIDER_SOLUTION_SKETCH = OBSTACLE_AVOIDER_STARTER_SKETCH.replace(
  /\/\/ TODO: replace[^\n]*\n[\s\S]*?const int ECHO = 0;[^\n]*/,
  OBSTACLE_AVOIDER_PINS,
).replace('const int TOO_CLOSE = 0;', OBSTACLE_AVOIDER_DISTANCE);

// ---- blink-traffic-light (owned by that tutorial; keep edits inside this section) ----
export const BLINK_TRAFFIC_LIGHT_STARTER_SKETCH = `
// Traffic light: red, then green, then yellow, then red again. Each LED has its own resistor.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int RED = 0;
const int YELLOW = 0;
const int GREEN = 0;

// Light the chosen LEDs, say which phase it is on the Serial Monitor, then wait.
void phase(bool red, bool yellow, bool green, const char *name, unsigned long ms) {
  digitalWrite(RED, red ? HIGH : LOW);
  digitalWrite(YELLOW, yellow ? HIGH : LOW);
  digitalWrite(GREEN, green ? HIGH : LOW);
  Serial.println(name);
  delay(ms);  // the Arduino does nothing else while it waits
}

void setup() {
  Serial.begin(9600);
  pinMode(RED, OUTPUT);
  pinMode(YELLOW, OUTPUT);
  pinMode(GREEN, OUTPUT);
}

void loop() {
  phase(true, false, false, "RED: stop", 4000);
  phase(false, false, true, "GREEN: go", 4000);
  phase(false, true, false, "YELLOW: get ready to stop", 1500);
}
`;

export const BLINK_TRAFFIC_LIGHT_PINS = `const int RED = 4;
const int YELLOW = 3;
const int GREEN = 2;`;

export const BLINK_TRAFFIC_LIGHT_SOLUTION_SKETCH = BLINK_TRAFFIC_LIGHT_STARTER_SKETCH.replace(
  /\/\/ TODO[^\n]*\n[\s\S]*?const int GREEN = 0;/,
  BLINK_TRAFFIC_LIGHT_PINS,
);
// ---- end blink-traffic-light ----

// ---- button-counter (owned by that tutorial; keep edits inside this section) ----
export const BUTTON_COUNTER_STARTER_SKETCH = `
// Button counter: counts presses of a push button and prints the total on the Serial Monitor.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int BUTTON = 0;  // the button's other side goes to GND
const unsigned long DEBOUNCE_MS = 30;  // ignore contact bounce shorter than this

int count = 0;
int lastReading = HIGH;  // INPUT_PULLUP: HIGH = released, LOW = pressed
int state = HIGH;        // the debounced button state
unsigned long changedAt = 0;

void setup() {
  Serial.begin(9600);
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println("Press the button!");
}

void loop() {
  int reading = digitalRead(BUTTON);
  if (reading != lastReading) {  // it moved: start timing
    changedAt = millis();
    lastReading = reading;
  }
  // Only trust a reading that has stayed the same for DEBOUNCE_MS.
  if (millis() - changedAt >= DEBOUNCE_MS && reading != state) {
    state = reading;
    digitalWrite(LED_BUILTIN, state == LOW ? HIGH : LOW);
    if (state == LOW) {  // released -> pressed: one new press
      count++;
      Serial.print("Count: ");
      Serial.println(count);
    }
  }
}
`;

export const BUTTON_COUNTER_PINS = `const int BUTTON = 2;  // the button's other side goes to GND`;

export const BUTTON_COUNTER_SOLUTION_SKETCH = BUTTON_COUNTER_STARTER_SKETCH.replace(
  /\/\/ TODO[^\n]*\n[\s\S]*?const int BUTTON = 0;[^\n]*/,
  BUTTON_COUNTER_PINS,
);
// ---- end button-counter ----

// ---- dimmer-knob (owned by that tutorial; keep edits inside this section) ----
export const DIMMER_KNOB_STARTER_SKETCH = `
// Dimmer: the knob's position sets the LED's brightness.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int KNOB = 0;  // the potentiometer's middle pin (an analog pin A0-A5)
const int LED = 0;   // the LED's resistor (a PWM pin ~)

unsigned long printedAt = 0;

void setup() {
  Serial.begin(9600);
  pinMode(KNOB, INPUT);  // analog pins start as inputs; this just says so
  pinMode(LED, OUTPUT);
}

void loop() {
  int knob = analogRead(KNOB);                   // 0 (0 V) ... 1023 (5 V)
  int brightness = map(knob, 0, 1023, 0, 255);   // analogWrite takes 0 ... 255
  analogWrite(LED, brightness);
  if (millis() - printedAt >= 250) {             // print 4 times a second
    printedAt = millis();
    Serial.print("Knob: ");
    Serial.print(knob);
    Serial.print("  Brightness: ");
    Serial.println(brightness);
  }
}
`;

export const DIMMER_KNOB_PINS = `const int KNOB = A0;  // the potentiometer's middle pin (an analog pin A0-A5)
const int LED = 9;   // the LED's resistor (a PWM pin ~)`;

export const DIMMER_KNOB_SOLUTION_SKETCH = DIMMER_KNOB_STARTER_SKETCH.replace(
  /\/\/ TODO[^\n]*\n[\s\S]*?const int LED = 0;[^\n]*/,
  DIMMER_KNOB_PINS,
);
// ---- end dimmer-knob ----

// ---- servo-sweep (owned by that tutorial; keep edits inside this section) ----
export const SERVO_SWEEP_STARTER_SKETCH = `
// Servo sweep: the horn swings from 0 to 180 degrees and back, one degree at a time.
#include <Servo.h>

// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int SERVO_PIN = 0;  // the servo's signal wire (orange)
const int STEP_MS = 15;   // wait per degree: smaller = faster sweep

Servo horn;
int sweeps = 0;

// Move to one angle, give the servo time to get there, and print the round numbers.
void moveTo(int angle) {
  horn.write(angle);
  delay(STEP_MS);
  if (angle % 45 == 0) {
    Serial.print("Angle: ");
    Serial.println(angle);
  }
}

void setup() {
  Serial.begin(9600);
  horn.attach(SERVO_PIN);  // start the control pulses on that pin
}

void loop() {
  // Up from 0 and back down to 1: the next sweep starts at 0 again, so no angle repeats.
  for (int angle = 0; angle < 180; angle++) moveTo(angle);
  for (int angle = 180; angle > 0; angle--) moveTo(angle);
  sweeps++;
  Serial.print("Sweep ");
  Serial.print(sweeps);
  Serial.println(" done");
}
`;

export const SERVO_SWEEP_PINS = `const int SERVO_PIN = 9;  // the servo's signal wire (orange)`;

export const SERVO_SWEEP_SOLUTION_SKETCH = SERVO_SWEEP_STARTER_SKETCH.replace(
  /\/\/ TODO[^\n]*\n[\s\S]*?const int SERVO_PIN = 0;[^\n]*/,
  SERVO_SWEEP_PINS,
);
// ---- end servo-sweep ----

// ---- weather-station (owned by that tutorial; keep edits inside this section) ----
export const WEATHER_STATION_STARTER_SKETCH = `
// Desk weather station: a DHT11 measures temperature and humidity every 2 s; the Serial Monitor
// shows them with a comfort tip.
#include <DHT.h>

// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int DHT_PIN = 0;  // the DHT11's DATA pin
const int TOO_HOT_C = 28;
const int TOO_COLD_C = 18;

DHT dht(DHT_PIN, DHT11);

void setup() {
  Serial.begin(9600);
  dht.begin();
  Serial.println("Desk weather station");
}

void loop() {
  delay(2000);  // the DHT11 needs a moment between readings
  float temp = dht.readTemperature();   // degrees Celsius
  float humidity = dht.readHumidity();  // percent
  if (isnan(temp) || isnan(humidity)) {
    Serial.println("Sensor error: check the DHT11 wiring");
    return;
  }
  Serial.print("Temp: ");
  Serial.print(temp, 0);
  Serial.print(" C  Humidity: ");
  Serial.print(humidity, 0);
  Serial.print(" %  ");
  if (temp >= TOO_HOT_C) Serial.println("Too hot! Open a window.");
  else if (temp <= TOO_COLD_C) Serial.println("Too cold! Grab a jumper.");
  else if (humidity < 30) Serial.println("The air is dry.");
  else if (humidity > 70) Serial.println("The air is humid.");
  else Serial.println("Comfortable.");
}
`;

export const WEATHER_STATION_PINS = `const int DHT_PIN = 2;  // the DHT11's DATA pin`;

export const WEATHER_STATION_SOLUTION_SKETCH = WEATHER_STATION_STARTER_SKETCH.replace(
  /\/\/ TODO[^\n]*\n[\s\S]*?const int DHT_PIN = 0;[^\n]*/,
  WEATHER_STATION_PINS,
);
// ---- end weather-station ----

// ---- square-track (owned by that tutorial; keep edits inside this section) ----
export const SQUARE_TRACK_STARTER_SKETCH = `
// Square track: follow the line, and at a sharp corner spin on the spot to find it again.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int ENA = 0;    // left motor speed (a PWM pin ~)
const int IN1 = 0;    // left motor forward
const int IN2 = 0;    // left motor backward
const int ENB = 0;    // right motor speed (a PWM pin ~)
const int IN3 = 0;    // right motor forward
const int IN4 = 0;    // right motor backward
const int LEFT = 0;   // line sensor outputs: HIGH over the black line
const int CENTER = 0;
const int RIGHT = 0;
const int SPEED = 140;     // cruising speed, 0-255
const int SPIN = 90;       // spin-turn speed
const int OVERSHOOT = 100; // ms to roll on after the line ends, so the wheels reach the corner

int turnTo = -1;  // where the line last ran off: -1 = left, 1 = right

// Signed speeds -255..255: positive turns a wheel forward, negative backward.
void drive(int left, int right) {
  digitalWrite(IN1, left > 0 ? HIGH : LOW);
  digitalWrite(IN2, left < 0 ? HIGH : LOW);
  analogWrite(ENA, abs(left));
  digitalWrite(IN3, right > 0 ? HIGH : LOW);
  digitalWrite(IN4, right < 0 ? HIGH : LOW);
  analogWrite(ENB, abs(right));
}

void setup() {
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(LEFT, INPUT); pinMode(CENTER, INPUT); pinMode(RIGHT, INPUT);
  delay(200);  // let the sensor power up before trusting its readings
}

void loop() {
  bool l = digitalRead(LEFT);
  bool c = digitalRead(CENTER);
  bool r = digitalRead(RIGHT);
  if (l && !r) turnTo = -1;  // an outer sensor alone on black: the line bends that way
  if (r && !l) turnTo = 1;

  if (l || c || r) {
    if (l && !c) drive(SPEED / 3, SPEED);       // well right of the line: turn left
    else if (l) drive(SPEED * 2 / 3, SPEED);    // a little right of it: ease left
    else if (r && !c) drive(SPEED, SPEED / 3);  // well left of the line: turn right
    else if (r) drive(SPEED, SPEED * 2 / 3);    // a little left of it: ease right
    else drive(SPEED, SPEED);                   // centred: straight on
  } else {
    // All white: the line ended under the sensor, so this is a corner.
    drive(SPEED, SPEED);                // roll on until the wheels are over the corner
    delay(OVERSHOOT);
    drive(turnTo * SPIN, -turnTo * SPIN);  // spin: one wheel forward, the other backward
    while (!digitalRead(CENTER)) {}        // until the centre eye finds the new line
  }
}
`;

export const SQUARE_TRACK_PINS = `const int ENA = 5;    // left motor speed (a PWM pin ~)
const int IN1 = 7;    // left motor forward
const int IN2 = 8;    // left motor backward
const int ENB = 6;    // right motor speed (a PWM pin ~)
const int IN3 = 9;    // right motor forward
const int IN4 = 10;   // right motor backward
const int LEFT = 2;   // line sensor outputs: HIGH over the black line
const int CENTER = 3;
const int RIGHT = 4;`;

export const SQUARE_TRACK_SOLUTION_SKETCH = SQUARE_TRACK_STARTER_SKETCH.replace(
  /\/\/ TODO[^\n]*\n[\s\S]*?const int RIGHT = 0;/,
  SQUARE_TRACK_PINS,
);
// ---- end square-track ----

// ---- mind-the-gap (owned by that tutorial; keep edits inside this section) ----
export const MIND_THE_GAP_STARTER_SKETCH = `
// Mind the gap: the robot remembers which side it last saw the line on, curves across gaps in the tape
// on that memory and, if the line stays gone too long, spins back towards that side to find it.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int ENA = 0;    // left motor speed (a PWM pin ~)
const int IN1 = 0;    // left motor forward
const int IN2 = 0;    // left motor backward
const int ENB = 0;    // right motor speed (a PWM pin ~)
const int IN3 = 0;    // right motor forward
const int IN4 = 0;    // right motor backward
const int LEFT = 0;   // line sensor outputs: HIGH over the black line
const int CENTER = 0;
const int RIGHT = 0;
const int SPEED = 140;                // cruising speed, 0-255
const unsigned long GAP_MS = 800;     // all white for longer than this: not a gap, the line is lost

int lastSeen = -1;          // memory: the side an outer eye last saw the line on, -1 = left, 1 = right
unsigned long lastLine = 0; // memory: millis() when any eye last saw the line

// Signed speeds -255..255: positive turns a wheel forward, negative backward.
void drive(int left, int right) {
  digitalWrite(IN1, left > 0 ? HIGH : LOW);
  digitalWrite(IN2, left < 0 ? HIGH : LOW);
  analogWrite(ENA, abs(left));
  digitalWrite(IN3, right > 0 ? HIGH : LOW);
  digitalWrite(IN4, right < 0 ? HIGH : LOW);
  analogWrite(ENB, abs(right));
}

void setup() {
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(LEFT, INPUT); pinMode(CENTER, INPUT); pinMode(RIGHT, INPUT);
  delay(200);  // let the sensor power up before trusting its readings
}

void loop() {
  bool l = digitalRead(LEFT);
  bool c = digitalRead(CENTER);
  bool r = digitalRead(RIGHT);

  if (l || c || r) {
    // The line is here: remember when, and which side it is drifting to, then steer as usual.
    lastLine = millis();
    if (l && !r) lastSeen = -1;
    if (r && !l) lastSeen = 1;
    if (l && !c) drive(SPEED / 3, SPEED);       // well right of the line: turn left
    else if (l) drive(SPEED * 2 / 3, SPEED);    // a little right of it: ease left
    else if (r && !c) drive(SPEED, SPEED / 3);  // well left of the line: turn right
    else if (r) drive(SPEED, SPEED * 2 / 3);    // a little left of it: ease right
    else drive(SPEED, SPEED);                   // centred: straight on
  } else if (millis() - lastLine < GAP_MS) {
    // All white, but only for a moment: probably a gap. Keep curving the way the line was bending.
    if (lastSeen < 0) drive(SPEED * 3 / 4, SPEED);
    else drive(SPEED, SPEED * 3 / 4);
  } else {
    // All white for too long: the robot has left the line. Circle back towards where it was last seen.
    if (lastSeen > 0) drive(SPEED, SPEED / 4);
    else drive(SPEED / 4, SPEED);
  }
}
`;

export const MIND_THE_GAP_PINS = `const int ENA = 5;    // left motor speed (a PWM pin ~)
const int IN1 = 7;    // left motor forward
const int IN2 = 8;    // left motor backward
const int ENB = 6;    // right motor speed (a PWM pin ~)
const int IN3 = 9;    // right motor forward
const int IN4 = 10;   // right motor backward
const int LEFT = 2;   // line sensor outputs: HIGH over the black line
const int CENTER = 3;
const int RIGHT = 4;`;

export const MIND_THE_GAP_SOLUTION_SKETCH = MIND_THE_GAP_STARTER_SKETCH.replace(
  /\/\/ TODO[^\n]*\n[\s\S]*?const int RIGHT = 0;/,
  MIND_THE_GAP_PINS,
);
// ---- end mind-the-gap ----

// ---- pid-line-follower (owned by that tutorial; keep edits inside this section) ----
export const PID_LINE_FOLLOWER_STARTER_SKETCH = `
// Smooth line follower: five sensors measure how far the line is off-centre (the error), and a PD
// controller turns that error into a speed difference between the two wheels.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int ENA = 0;    // left motor speed (a PWM pin ~)
const int IN1 = 0;    // left motor forward
const int IN2 = 0;    // left motor backward
const int ENB = 0;    // right motor speed (a PWM pin ~)
const int IN3 = 0;    // right motor forward
const int IN4 = 0;    // right motor backward
const int S1 = 0;     // line sensor outputs, S1 far left to S5 far right: HIGH over the line
const int S2 = 0;
const int S3 = 0;
const int S4 = 0;
const int S5 = 0;
// TODO: tune the controller (last step): KP steers against the error, KD against how fast it changes.
const float KP = 0;
const float KD = 0;
const int BASE = 200;  // speed of both wheels when the line is centred, 0-255

const int WEIGHT[5] = {-2, -1, 0, 1, 2};  // where each eye sits, from left (-2) to right (2)

float lastError = 0;
unsigned long lastTick = 0;

// Signed speeds -255..255: positive turns a wheel forward, negative backward.
void drive(int left, int right) {
  left = constrain(left, -255, 255);
  right = constrain(right, -255, 255);
  digitalWrite(IN1, left > 0 ? HIGH : LOW);
  digitalWrite(IN2, left < 0 ? HIGH : LOW);
  analogWrite(ENA, abs(left));
  digitalWrite(IN3, right > 0 ? HIGH : LOW);
  digitalWrite(IN4, right < 0 ? HIGH : LOW);
  analogWrite(ENB, abs(right));
}

void setup() {
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(S1, INPUT); pinMode(S2, INPUT); pinMode(S3, INPUT); pinMode(S4, INPUT); pinMode(S5, INPUT);
  delay(200);  // let the sensor power up before trusting its readings
}

void loop() {
  if (millis() - lastTick < 10) return;  // run the controller every 10 ms
  lastTick = millis();

  bool eye[5] = {digitalRead(S1), digitalRead(S2), digitalRead(S3), digitalRead(S4), digitalRead(S5)};
  int seen = 0;
  int sum = 0;
  for (int i = 0; i < 5; i++) {
    if (eye[i]) {
      sum += WEIGHT[i];
      seen++;
    }
  }
  if (seen >= 4) {  // (almost) all black: the crossing in the middle of the eight. Straight across.
    drive(BASE, BASE);
    return;
  }

  float error;  // how far the line is right of centre: -2 (far left) to 2 (far right)
  if (seen == 0) error = lastError > 0 ? 3 : -3;  // lost: past an outer eye, on the side it was last
  else error = (float)sum / seen;

  float turn = KP * error + KD * (error - lastError);
  lastError = error;
  drive(BASE + turn, BASE - turn);  // line to the right: left wheel faster, right slower
}
`;

export const PID_LINE_FOLLOWER_PINS = `const int ENA = 5;    // left motor speed (a PWM pin ~)
const int IN1 = 7;    // left motor forward
const int IN2 = 8;    // left motor backward
const int ENB = 6;    // right motor speed (a PWM pin ~)
const int IN3 = 9;    // right motor forward
const int IN4 = 10;   // right motor backward
const int S1 = 2;     // line sensor outputs, S1 far left to S5 far right: HIGH over the line
const int S2 = 3;
const int S3 = 4;
const int S4 = 11;
const int S5 = 12;`;

export const PID_LINE_FOLLOWER_GAINS = `const float KP = 60;
const float KD = 400;`;

export const PID_LINE_FOLLOWER_SOLUTION_SKETCH = PID_LINE_FOLLOWER_STARTER_SKETCH.replace(
  /\/\/ TODO: replace[^\n]*\n[\s\S]*?const int S5 = 0;/,
  PID_LINE_FOLLOWER_PINS,
).replace(/const float KP = 0;\nconst float KD = 0;/, PID_LINE_FOLLOWER_GAINS);
// ---- end pid-line-follower ----

// ---- scanning-avoider (owned by that tutorial; keep edits inside this section) ----
export const SCANNING_AVOIDER_STARTER_SKETCH = `
// Scanning obstacle avoider: the HC-SR04 rides on an SG90 servo like a head on a neck. While driving,
// the head keeps glancing ahead, a little left and a little right, so it spots a corner before a wheel
// hits it. When something is in the way the robot stops, looks left and right, and turns towards the
// side with more room until the way ahead is clear. Once past, it looks back towards the goal and turns
// back as soon as that way is clear.
#include <Servo.h>

// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int ENA = 0;        // left motor speed (a PWM pin ~)
const int IN1 = 0;        // left motor direction
const int IN2 = 0;
const int ENB = 0;        // right motor speed (a PWM pin ~)
const int IN3 = 0;        // right motor direction
const int IN4 = 0;
const int TRIG = 0;       // sonar trigger
const int ECHO = 0;       // sonar echo
const int SERVO_PIN = 0;  // the servo's signal wire (orange)

const int TOO_CLOSE = 25;   // cm (try 20-35): anything nearer in the robot's path makes it stop and look
const int BACK_OFF = 12;    // cm: nearer than this, back up a little first
const int HALF_WIDTH = 11;  // cm from the middle of the robot to the outside of a wheel, plus a margin
const int CLEAR = 60;       // cm: a way this open is free to drive into
const int SPEED = 160;      // 0-255
const int TURN_SPEED = 130;
const int STEP_MS = 60;     // turn in small steps, measuring after each
const int PASS_MS = 900;    // drive on this long before looking back

// The servo angles: 90 looks straight ahead, 170 almost straight to the left, 10 to the right.
const int AHEAD = 90;
const int LEFT = 170;
const int RIGHT = 10;
// Where the head glances while driving: ahead, a bit right, ahead, a bit left.
const int GLANCE[] = {90, 65, 90, 115};

Servo neck;
int glance = 0;
long turned = 0;  // ms turned left (+) or right (-) away from the way to the goal
unsigned long lastTurn = 0;

void drive(int left, int right) {  // -255..255
  digitalWrite(IN1, left > 0 ? HIGH : LOW);
  digitalWrite(IN2, left < 0 ? HIGH : LOW);
  analogWrite(ENA, abs(left));
  digitalWrite(IN3, right > 0 ? HIGH : LOW);
  digitalWrite(IN4, right < 0 ? HIGH : LOW);
  analogWrite(ENB, abs(right));
}

// Both inputs HIGH: the driver shorts each motor, which brakes it instead of letting it roll on.
void brake() {
  digitalWrite(IN1, HIGH); digitalWrite(IN2, HIGH); analogWrite(ENA, 255);
  digitalWrite(IN3, HIGH); digitalWrite(IN4, HIGH); analogWrite(ENB, 255);
  delay(150);
  drive(0, 0);
}

// The sonar sends a click and times its echo: sound needs 58 microseconds per cm there and back.
long distanceCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);
  return us == 0 ? 500 : us / 58;  // no echo: nothing in range
}

// Turn the head, give the servo time to get there, then measure.
long look(int angle, int waitMs) {
  neck.write(angle);
  delay(waitMs);
  return distanceCm();
}

// An echo cm away with the head at this angle: is it in the robot's path, and nearer than TOO_CLOSE?
// Split the distance into how far ahead it is and how far to the side, like x and y on a map.
bool inPath(int angle, long cm) {
  float a = (angle - AHEAD) * PI / 180;
  return cm * cos(a) < TOO_CLOSE && abs(cm * sin(a)) < HALF_WIDTH;
}

// One small turn on the spot: dir 1 turns left, -1 right.
void turnStep(int dir) {
  if (dir > 0) drive(-TURN_SPEED, TURN_SPEED);
  else drive(TURN_SPEED, -TURN_SPEED);
  delay(STEP_MS);
  brake();
  turned += dir * STEP_MS;
}

// Turn until the head, looking ahead, sees open space; then one more step so the wheels clear the corner.
void turnUntilClear(int dir) {
  neck.write(AHEAD);
  delay(150);
  for (int i = 0; i < 30 && distanceCm() < CLEAR; i++) turnStep(dir);
  turnStep(dir);
  turnStep(dir);
  lastTurn = millis();
}

void avoid() {
  brake();
  if (look(AHEAD, 120) < BACK_OFF) {  // very close: back up a little first
    drive(-SPEED, -SPEED);
    delay(250);
    brake();
  }
  long left = look(LEFT, 250);
  long right = look(RIGHT, 250);
  turnUntilClear(left > right ? 1 : -1);
}

void setup() {
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  neck.attach(SERVO_PIN);
  neck.write(AHEAD);
  delay(300);
}

void loop() {
  int angle = GLANCE[glance];
  glance = (glance + 1) % 4;
  if (inPath(angle, look(angle, 60))) {
    avoid();
  } else if (turned != 0 && millis() - lastTurn > PASS_MS) {
    brake();                          // past it? look back towards the goal
    int dir = turned > 0 ? -1 : 1;
    if (look(dir > 0 ? LEFT : RIGHT, 250) > CLEAR) {
      long goal = turned;             // turn back, but stop if something comes into the way
      neck.write(AHEAD);
      delay(150);
      while (turned * goal > 0 && abs(turned) > 0 && distanceCm() > TOO_CLOSE) turnStep(dir);
    }
    lastTurn = millis();
  } else {
    drive(SPEED, SPEED);
  }
}
`;

export const SCANNING_AVOIDER_PINS = `const int ENA = 5;        // left motor speed (a PWM pin ~)
const int IN1 = 7;        // left motor direction
const int IN2 = 8;
const int ENB = 6;        // right motor speed (a PWM pin ~)
const int IN3 = 9;        // right motor direction
const int IN4 = 10;
const int TRIG = 12;      // sonar trigger
const int ECHO = 11;      // sonar echo
const int SERVO_PIN = 3;  // the servo's signal wire (orange)`;

export const SCANNING_AVOIDER_SOLUTION_SKETCH = SCANNING_AVOIDER_STARTER_SKETCH.replace(
  /\/\/ TODO: replace[^\n]*\n[\s\S]*?const int SERVO_PIN = 0;[^\n]*/,
  SCANNING_AVOIDER_PINS,
);
// ---- end scanning-avoider ----

// ---- maze-explorer (owned by that tutorial; keep edits inside this section) ----
export const MAZE_EXPLORER_STARTER_SKETCH = `
// Maze explorer: keep your right hand on the wall and you get out of any maze like this one.
// Two HC-SR04 sonars look ahead and to the right. The robot is always in one of two states:
//   DECIDE  - standing in the middle of a 45 cm cell: right if the right side is open, else straight on
//             if the way ahead is clear, else turn left and look again (twice left = turn around).
//   FORWARD - driving one cell ahead, steering to keep the right wall at the same distance.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int ENA = 0;         // left motor speed (a PWM pin ~)
const int IN1 = 0;         // left motor direction
const int IN2 = 0;
const int ENB = 0;         // right motor speed (a PWM pin ~)
const int IN3 = 0;         // right motor direction
const int IN4 = 0;
const int TRIG_FRONT = 0;  // sonar looking ahead
const int ECHO_FRONT = 0;
const int TRIG_RIGHT = 0;  // sonar looking right
const int ECHO_RIGHT = 0;
// TODO: how many milliseconds does the robot need to turn 90 degrees on the spot?
const int TURN_MS = 0;

const int SPEED = 110;       // 0-255
const int TURN_SPEED = 120;
const int CELL_MM = 450;     // one maze cell
const int WALL_MM = 150;     // the right wall's distance when the robot is centred
const int OPEN_MM = 300;     // farther than this: no wall there, a way to go
const int STOP_MM = 155;     // a wall ahead this close: the robot is in the middle of its cell
const int CELL_MS = 1750;    // one cell takes about this long when there is no wall ahead to measure

const int DECIDE = 0;
const int FORWARD = 1;
int state = DECIDE;
int target = 0;              // FORWARD ends when the wall ahead is this close (0: use the clock)
unsigned long until = 0;
int lastErr = 0;

void drive(int left, int right) {  // -255..255
  digitalWrite(IN1, left > 0 ? HIGH : LOW);
  digitalWrite(IN2, left < 0 ? HIGH : LOW);
  analogWrite(ENA, abs(left));
  digitalWrite(IN3, right > 0 ? HIGH : LOW);
  digitalWrite(IN4, right < 0 ? HIGH : LOW);
  analogWrite(ENB, abs(right));
}

// Both inputs LOW with the enables on: the L298N shorts the motors and they stop at once.
void brake() {
  drive(0, 0);
  analogWrite(ENA, 255);
  analogWrite(ENB, 255);
  delay(150);
}

void turn(int dir) {  // 1 = right, -1 = left
  drive(dir * TURN_SPEED, -dir * TURN_SPEED);
  delay(TURN_MS);
  brake();
}

// Distance in mm: the echo takes 5.8 microseconds per mm there and back.
int mm(int trig, int echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  long us = pulseIn(echo, HIGH, 30000);
  return us == 0 ? 2000 : us * 10 / 58;  // no echo: nothing in range
}

int frontMm() { return mm(TRIG_FRONT, ECHO_FRONT); }
int rightMm() { return mm(TRIG_RIGHT, ECHO_RIGHT); }

void setup() {
  Serial.begin(9600);
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(TRIG_FRONT, OUTPUT); pinMode(ECHO_FRONT, INPUT);
  pinMode(TRIG_RIGHT, OUTPUT); pinMode(ECHO_RIGHT, INPUT);
  digitalWrite(TRIG_FRONT, LOW);  // the sonars wait with TRIG low
  digitalWrite(TRIG_RIGHT, LOW);
  delay(500);
}

void loop() {
  if (state == DECIDE) {
    if (rightMm() > OPEN_MM) {
      Serial.println("right");
      turn(1);
    } else if (frontMm() > OPEN_MM) {
      Serial.println("ahead");
    } else {
      Serial.println("left");
      turn(-1);
      return;  // still DECIDE: look again from here
    }
    // Next cell: if there is a wall ahead, stop when it is one cell closer; otherwise go by the clock.
    int ahead = frontMm();
    target = ahead < 1800 ? max(ahead - CELL_MM, STOP_MM) : 0;
    until = millis() + CELL_MS;
    lastErr = 0;
    state = FORWARD;
  } else {  // FORWARD
    int f = frontMm();
    if (f <= STOP_MM || (target > 0 ? f <= target : millis() >= until)) {
      brake();
      state = DECIDE;
      return;
    }
    int r = rightMm();
    int err = r < OPEN_MM ? r - WALL_MM : 0;  // positive: too far from the right wall
    int steer = constrain(err / 4 + (err - lastErr), -40, 40);
    lastErr = err;
    drive(SPEED + steer, SPEED - steer);
  }
}
`;

export const MAZE_EXPLORER_PINS = `const int ENA = 5;         // left motor speed (a PWM pin ~)
const int IN1 = 7;         // left motor direction
const int IN2 = 8;
const int ENB = 6;         // right motor speed (a PWM pin ~)
const int IN3 = 9;         // right motor direction
const int IN4 = 10;
const int TRIG_FRONT = 12; // sonar looking ahead
const int ECHO_FRONT = 11;
const int TRIG_RIGHT = 4;  // sonar looking right
const int ECHO_RIGHT = 3;`;
export const MAZE_EXPLORER_TURN = 'const int TURN_MS = 370;';

export const MAZE_EXPLORER_SOLUTION_SKETCH = MAZE_EXPLORER_STARTER_SKETCH.replace(
  /\/\/ TODO: replace[^\n]*\n[\s\S]*?const int ECHO_RIGHT = 0;/,
  MAZE_EXPLORER_PINS,
).replace('const int TURN_MS = 0;', MAZE_EXPLORER_TURN);
// ---- end maze-explorer ----

// ---- sumo-bot (owned by that tutorial; keep edits inside this section) ----
export const SUMO_BOT_STARTER_SKETCH = `
// Sumo bot: push the opponent out of the ring without leaving it yourself.
// Every pass of loop() asks three questions, most important first, and acts on the first "yes":
//   1. EDGE   - does a line sensor see the white edge? Back off and turn away. Nothing matters more.
//   2. ATTACK - does the sonar see the opponent? Charge at full power.
//   3. SEARCH - nothing seen: spin on the spot and look around.
// TODO: replace each 0 with the Arduino pin that wire goes to (look at your circuit).
const int ENA = 0;     // left motor speed (a PWM pin ~)
const int IN1 = 0;     // left motor direction
const int IN2 = 0;
const int ENB = 0;     // right motor speed (a PWM pin ~)
const int IN3 = 0;     // right motor direction
const int IN4 = 0;
const int LEFT = 0;    // line sensor outputs: HIGH over the black ring, LOW over the white edge
const int CENTER = 0;
const int RIGHT = 0;
const int TRIG = 0;    // sonar trigger
const int ECHO = 0;    // sonar echo
// TODO: how near (in cm) must something be to count as the opponent?
const int SEE_CM = 0;

const int CHARGE = 255;  // full power
const int SEARCH = 100;  // slow spin while looking
unsigned long seen = 0;  // when the opponent was last in sight (ms)
int spin = 1;            // search direction: 1 = clockwise (right), -1 = anticlockwise
bool attacking = false;

void drive(int left, int right) {  // -255..255
  digitalWrite(IN1, left > 0 ? HIGH : LOW);
  digitalWrite(IN2, left < 0 ? HIGH : LOW);
  analogWrite(ENA, abs(left));
  digitalWrite(IN3, right > 0 ? HIGH : LOW);
  digitalWrite(IN4, right < 0 ? HIGH : LOW);
  analogWrite(ENB, abs(right));
}

// Both inputs LOW with the enables on: the L298N shorts the motors and they stop at once.
void brake() {
  drive(0, 0);
  analogWrite(ENA, 255);
  analogWrite(ENB, 255);
  delay(100);
}

// Sound needs 58 microseconds per cm there and back. Waiting at most 6 ms means looking about 1 m
// ahead: the loop stays quick, so the edge is never missed while the sonar listens.
long distanceCm() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 6000);
  return us == 0 ? 999 : us / 58;  // no echo: nothing in range
}

void setup() {
  Serial.begin(9600);
  pinMode(ENA, OUTPUT); pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT);
  pinMode(ENB, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(LEFT, INPUT); pinMode(CENTER, INPUT); pinMode(RIGHT, INPUT);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  delay(1000);  // sumo rule: wait for the start signal
}

void loop() {
  bool edgeL = digitalRead(LEFT) == LOW;  // LOW: this eye sees white
  bool edgeC = digitalRead(CENTER) == LOW;
  bool edgeR = digitalRead(RIGHT) == LOW;

  // 1. EDGE: back off, turn away from the side that saw it, and drive back towards the middle.
  // Near the edge the arena walls are close enough to look like an opponent, so the robot does not
  // look while it drives back in: from the middle, everything it can see is inside the ring.
  if (edgeL || edgeC || edgeR) {
    Serial.println("edge");
    int away = edgeL && !edgeR ? 1 : -1;  // 1 = turn right
    drive(-CHARGE, -CHARGE);
    delay(250);
    drive(away * 150, -away * 150);
    delay(550);
    drive(180, 180);
    for (int i = 0; i < 120; i++) {  // up to 1.2 s, unless the edge comes first
      if (digitalRead(LEFT) == LOW || digitalRead(CENTER) == LOW || digitalRead(RIGHT) == LOW) break;
      delay(10);
    }
    seen = 0;
    attacking = false;
    return;
  }

  // 2. ATTACK: pressed right against the opponent the echo is too close to measure, so keep
  // charging for a moment after the last sighting.
  if (distanceCm() < SEE_CM) {
    if (millis() - seen > 400) brake();  // just spotted while spinning: stop turning first
    seen = millis();
  }
  if (seen > 0 && millis() - seen < 400) {
    attacking = true;
    drive(CHARGE, CHARGE);
    return;
  }

  // 3. SEARCH: if the opponent just slipped out of view, it is most likely back the way the robot
  // was turning (it overshot), so search the other way round.
  if (attacking) spin = -spin;
  attacking = false;
  drive(spin * SEARCH, -spin * SEARCH);
}
`;

export const SUMO_BOT_PINS = `const int ENA = 5;     // left motor speed (a PWM pin ~)
const int IN1 = 7;     // left motor direction
const int IN2 = 8;
const int ENB = 6;     // right motor speed (a PWM pin ~)
const int IN3 = 9;     // right motor direction
const int IN4 = 10;
const int LEFT = 2;    // line sensor outputs: HIGH over the black ring, LOW over the white edge
const int CENTER = 3;
const int RIGHT = 4;
const int TRIG = 12;   // sonar trigger
const int ECHO = 11;   // sonar echo`;
export const SUMO_BOT_RANGE = 'const int SEE_CM = 85;';

export const SUMO_BOT_SOLUTION_SKETCH = SUMO_BOT_STARTER_SKETCH.replace(
  /\/\/ TODO: replace[^\n]*\n[\s\S]*?const int ECHO = 0;[^\n]*/,
  SUMO_BOT_PINS,
).replace('const int SEE_CM = 0;', SUMO_BOT_RANGE);
// ---- end sumo-bot ----

/** Reference solutions compiled by `pnpm firmware:gen`. */
export const GUIDED_SKETCHES = {
  lineFollower: LINE_FOLLOWER_SOLUTION_SKETCH,
  obstacleAvoider: OBSTACLE_AVOIDER_SOLUTION_SKETCH,
  blinkTrafficLight: BLINK_TRAFFIC_LIGHT_SOLUTION_SKETCH,
  buttonCounter: BUTTON_COUNTER_SOLUTION_SKETCH,
  dimmerKnob: DIMMER_KNOB_SOLUTION_SKETCH,
  servoSweep: SERVO_SWEEP_SOLUTION_SKETCH,
  weatherStation: WEATHER_STATION_SOLUTION_SKETCH,
  squareTrack: SQUARE_TRACK_SOLUTION_SKETCH,
  mindTheGap: MIND_THE_GAP_SOLUTION_SKETCH,
  pidLineFollower: PID_LINE_FOLLOWER_SOLUTION_SKETCH,
  scanningAvoider: SCANNING_AVOIDER_SOLUTION_SKETCH,
  mazeExplorer: MAZE_EXPLORER_SOLUTION_SKETCH,
  sumoBot: SUMO_BOT_SOLUTION_SKETCH,
} as const;

export type GuidedSketchId = keyof typeof GUIDED_SKETCHES;
