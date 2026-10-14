/**
 * Demo firmware as AVR assembly — what the matching Arduino sketches compile to, minus the core.
 * `pnpm --filter @robosim/sim-runtime gen:firmware` assembles these into `generated.ts`; a test
 * fails if the two drift apart. (Real sketches arrive with the build service.)
 */
export const FIRMWARE_SOURCES = {
  /** digitalWrite(13, !digitalRead(13)); delay(500); */
  blink: `
      ldi r16, 0x20
      out 0x04, r16        ; DDRB: D13 output
    loop:
      out 0x03, r16        ; toggle D13
      ldi r18, 41
    d1: ldi r19, 0
    d2: ldi r20, 0
    d3: dec r20
      brne d3
      dec r19
      brne d2
      dec r18
      brne d1              ; ≈ 8.1 M cycles ≈ 0.5 s
      rjmp loop
  `,
  /** pinMode(2, INPUT_PULLUP); digitalWrite(13, !digitalRead(2)); */
  button: `
      ldi r16, 0x20
      out 0x04, r16
      ldi r17, 0x04
      out 0x0b, r17        ; pull-up on D2
    loop:
      sbis 0x09, 2
      sbi 0x05, 5
      sbic 0x09, 2
      cbi 0x05, 5
      rjmp loop
  `,
  /** analogWrite(6, analogRead(A0) / 4); */
  dimmer: `
      ldi r16, 0x40
      out 0x0a, r16        ; DDRD: D6 output
      ldi r16, 0x83
      out 0x24, r16        ; TCCR0A: COM0A1 | fast PWM
      ldi r16, 0x03
      out 0x25, r16        ; TCCR0B: /64
      ldi r16, 0x60
      sts 0x7C, r16        ; ADMUX: AVcc, left-adjusted, A0
    loop:
      ldi r16, 0xC7
      sts 0x7A, r16        ; ADCSRA: start conversion
    wait:
      lds r17, 0x7A
      sbrc r17, 6
      rjmp wait
      lds r18, 0x79        ; ADCH (8 bits)
      out 0x27, r18        ; OCR0A
      rjmp loop
  `,
  /** servo.writeMicroseconds(500 + analogRead(A0) * 2); — timer1 mode 14, 50 Hz on D9 */
  servo: `
      ldi r16, 0x02
      out 0x04, r16        ; DDRB: D9 output
      ldi r16, 0x9C
      sts 0x87, r16        ; ICR1H
      ldi r16, 0x3F
      sts 0x86, r16        ; ICR1L = 39999 → 20 ms
      ldi r16, 0x82
      sts 0x80, r16        ; TCCR1A: COM1A1 | WGM11
      ldi r16, 0x1A
      sts 0x81, r16        ; TCCR1B: WGM13 | WGM12 | /8 (0.5 µs ticks)
      ldi r16, 0x40
      sts 0x7C, r16        ; ADMUX: AVcc, right-adjusted, A0
    loop:
      ldi r16, 0xC7
      sts 0x7A, r16
    wait:
      lds r17, 0x7A
      sbrc r17, 6
      rjmp wait
      lds r18, 0x78        ; ADCL
      lds r19, 0x79        ; ADCH
      lsl r18
      rol r19
      lsl r18
      rol r19              ; × 4 ticks = × 2 µs
      subi r18, 0x18
      sbci r19, 0xFC       ; + 1000 ticks (500 µs)
      sts 0x89, r19        ; OCR1AH first
      sts 0x88, r18
      rjmp loop
  `,
  /** Bang-bang line follower: L/C/R on D2/D3/D4 (HIGH = black), ENA/ENB PWM on D5/D6, IN1 D7, IN3 D9. */
  lineFollower: `
      ldi r16, 0xE0
      out 0x0a, r16
      ldi r16, 0x07
      out 0x04, r16
      ldi r16, 150
      out 0x27, r16
      out 0x28, r16
      ldi r16, 0xA3
      out 0x24, r16
      ldi r16, 0x03
      out 0x25, r16
    loop:
      sbic 0x09, 2
      rjmp left
      sbic 0x09, 4
      rjmp right
      sbic 0x09, 3
      rjmp straight
      rjmp loop
    straight:
      sbi 0x0b, 7
      sbi 0x05, 1
      rjmp loop
    left:
      cbi 0x0b, 7
      sbi 0x05, 1
      rjmp loop
    right:
      sbi 0x0b, 7
      cbi 0x05, 1
      rjmp loop
  `,
  /** pinMode(2, OUTPUT); pinMode(3, OUTPUT); digitalWrite(2, HIGH); digitalWrite(3, LOW); — with D2 wired to D3 */
  fighting: `
      ldi r16, 0x0C
      out 0x0a, r16        ; DDRD: D2, D3 outputs
      ldi r16, 0x04
      out 0x0b, r16        ; D2 HIGH, D3 LOW
    halt: rjmp halt
  `,
  /** pinMode(9, OUTPUT); digitalWrite(9, HIGH); — a motor straight on the pin */
  pinHigh: `
      ldi r16, 0x02
      out 0x04, r16
      out 0x05, r16        ; D9 HIGH
    halt: rjmp halt
  `,
  /** pinMode(2, INPUT); digitalWrite(13, !digitalRead(2)); — no pull-up */
  floating: `
      ldi r16, 0x20
      out 0x04, r16
    loop:
      sbis 0x09, 2
      sbi 0x05, 5
      sbic 0x09, 2
      cbi 0x05, 5
      rjmp loop
  `,
} as const;

export type FirmwareId = keyof typeof FIRMWARE_SOURCES;
