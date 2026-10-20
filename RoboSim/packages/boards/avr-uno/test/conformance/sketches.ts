// Arduino sketches of the peripheral conformance suite (Engineering Guide §6). `pnpm firmware:gen` compiles
// them with the build service (apps/compiler) into generated.ts; a compiler test fails if the two drift apart.
export const CONFORMANCE_SKETCHES = {
  // Every PWM pin at a different duty: Timer0 fast PWM (D5, D6), Timer1/Timer2 phase-correct (D9, D10, D3, D11).
  pwm: `
void setup() {
  analogWrite(3, 64);
  analogWrite(5, 128);
  analogWrite(6, 191);
  analogWrite(9, 32);
  analogWrite(10, 224);
  analogWrite(11, 100);
}
void loop() {}`,
  // D4: one delayMicroseconds(1000) pulse framed by single-instruction port writes. D7 toggles every 100 ms
  // of millis(), D8 every 500 µs of micros().
  timing: `
void setup() {
  pinMode(4, OUTPUT);
  pinMode(7, OUTPUT);
  pinMode(8, OUTPUT);
  PORTD |= _BV(4);
  delayMicroseconds(1000);
  PORTD &= ~_BV(4);
}
unsigned long ms = 0, us = 0;
void loop() {
  if (millis() - ms >= 100) { ms += 100; PIND = _BV(7); }
  if (micros() - us >= 500) { us += 500; PINB = _BV(0); }
}`,
  // tone() on Timer2, the Servo library on Timer1.
  toneServo: `
#include <Servo.h>
Servo servo;
void setup() {
  tone(8, 440);
  servo.attach(9);
  servo.writeMicroseconds(1500);
}
void loop() {}`,
  // D8 frames ten conversions; then every 20 ms all six channels, then A1 against the 1.1 V reference.
  adc: `
void setup() {
  Serial.begin(115200);
  pinMode(8, OUTPUT);
  analogRead(A0);
  PORTB |= _BV(0);
  for (int i = 0; i < 10; i++) analogRead(A0);
  PORTB &= ~_BV(0);
}
void loop() {
  analogReference(DEFAULT);
  analogRead(A0);
  for (int i = 0; i < 6; i++) { Serial.print(analogRead(A0 + i)); Serial.print(' '); }
  analogReference(INTERNAL);
  analogRead(A1);
  Serial.println(analogRead(A1));
  delay(20);
}`,
  // Ten bytes at 9600 baud, ten at 115200, then an echo that adds one to every byte received.
  uart: `
void setup() {
  Serial.begin(9600);
  Serial.print("0123456789");
  Serial.flush();
  Serial.end();
  Serial.begin(115200);
  Serial.print("abcdefghij");
}
void loop() {
  if (Serial.available()) Serial.write(Serial.read() + 1);
}`,
  // INT0 rising (its ISR toggles D13: latency), INT1 falling, pin change on D4, and Timer1 CTC at 2 kHz
  // toggling D8 from its compare ISR. Any byte on the serial port prints the counters.
  interrupts: `
volatile unsigned int rising = 0, falling = 0, changes = 0;
void onRise() { rising++; PINB = _BV(5); }
void onFall() { falling++; }
ISR(PCINT2_vect) { changes++; }
ISR(TIMER1_COMPA_vect) { PINB = _BV(0); }
void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT);
  pinMode(8, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(2), onRise, RISING);
  attachInterrupt(digitalPinToInterrupt(3), onFall, FALLING);
  PCICR |= _BV(PCIE2);
  PCMSK2 |= _BV(PCINT20);
  noInterrupts();
  TCCR1A = 0;
  TCCR1B = _BV(WGM12) | _BV(CS11);
  OCR1A = 999;
  TIMSK1 = _BV(OCIE1A);
  interrupts();
}
void loop() {
  if (Serial.available()) {
    Serial.read();
    noInterrupts();
    unsigned int r = rising, f = falling, c = changes;
    interrupts();
    Serial.print(r); Serial.print(' '); Serial.print(f); Serial.print(' '); Serial.println(c);
  }
}`,
  pulseIn: `
void setup() { Serial.begin(115200); pinMode(7, INPUT); }
void loop() { Serial.println(pulseIn(7, HIGH, 100000UL)); }`,
  // Boot counter in byte 0, a float round trip, and the time two back-to-back writes take.
  eeprom: `
#include <EEPROM.h>
void setup() {
  Serial.begin(115200);
  byte boots = EEPROM.read(0);
  EEPROM.write(0, boots + 1);
  float f = 0;
  EEPROM.put(10, 3.14159f);
  EEPROM.get(10, f);
  EEPROM.write(1, 1);
  unsigned long t = micros();
  EEPROM.write(2, 2);
  EEPROM.write(3, 3);
  t = micros() - t;
  Serial.print("boot "); Serial.print(boots);
  Serial.print(" len "); Serial.print(EEPROM.length());
  Serial.print(" f "); Serial.print(f, 5);
  Serial.print(" us "); Serial.println(t);
}
void loop() {}`,
  // A 3-byte write at 100 kHz and at 400 kHz to 0x50, an address nobody answers, and a 3-byte read.
  i2c: `
#include <Wire.h>
void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.setClock(100000);
  Wire.beginTransmission(0x50); Wire.write(0x10); Wire.write(0xAB); Wire.write(0xCD);
  byte e1 = Wire.endTransmission();
  Wire.setClock(400000);
  Wire.beginTransmission(0x50); Wire.write(0x10); Wire.write(0xAB); Wire.write(0xCD);
  Wire.endTransmission();
  Wire.beginTransmission(0x51);
  byte e2 = Wire.endTransmission();
  byte n = Wire.requestFrom(0x50, 3);
  Serial.print(e1); Serial.print(' '); Serial.print(e2); Serial.print(' '); Serial.print(n);
  while (Wire.available()) { Serial.print(' '); Serial.print(Wire.read()); }
  Serial.println();
}
void loop() {}`,
  // Two bytes at 1 MHz and one at 4 MHz, each framed by D10 (chip select); prints what came back.
  spi: `
#include <SPI.h>
void setup() {
  Serial.begin(115200);
  pinMode(10, OUTPUT);
  digitalWrite(10, HIGH);
  SPI.begin();
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(10, LOW);
  byte a = SPI.transfer(0x3C);
  byte b = SPI.transfer(0xC3);
  digitalWrite(10, HIGH);
  SPI.endTransaction();
  SPI.beginTransaction(SPISettings(4000000, MSBFIRST, SPI_MODE0));
  digitalWrite(10, LOW);
  byte c = SPI.transfer(0x5A);
  digitalWrite(10, HIGH);
  SPI.endTransaction();
  Serial.print(a); Serial.print(' '); Serial.print(b); Serial.print(' '); Serial.println(c);
}
void loop() {}`,
} as const;

export type ConformanceSketchId = keyof typeof CONFORMANCE_SKETCHES;
