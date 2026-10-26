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

/** Reference solutions compiled by `pnpm firmware:gen`. */
export const GUIDED_SKETCHES = {
  lineFollower: LINE_FOLLOWER_SOLUTION_SKETCH,
  obstacleAvoider: OBSTACLE_AVOIDER_SOLUTION_SKETCH,
} as const;

export type GuidedSketchId = keyof typeof GUIDED_SKETCHES;
