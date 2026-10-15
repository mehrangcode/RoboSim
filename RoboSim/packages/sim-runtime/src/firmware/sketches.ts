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
