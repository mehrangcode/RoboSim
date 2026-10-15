import { PITCH, addComponent, addWire, blankProject, setProp } from '@robosim/circuit-canvas';
import type { ProjectDocument } from '@robosim/shared';

const BLINK = `// Blink: the LED on the breadboard follows pin 13.
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

const g = (steps: number): number => steps * PITCH;

/**
 * The Design tab's starting point: Uno, half breadboard, 220 Ω + LED plugged into the strips,
 * jumpers from D13 to the resistor's strip and from the LED's strip over the − rail to GND.
 */
export function starterProject(title: string): ProjectDocument {
  let doc = blankProject(title, BLINK);
  doc = addComponent(doc, 'passive.breadboard-half', [g(32), g(0)]).doc;
  doc = addComponent(doc, 'passive.resistor', [g(42), g(3)]).doc; // 10a–14a
  doc = setProp(doc, 'r1', 'ohms', 220);
  doc = addComponent(doc, 'actuator.led', [g(46), g(4)]).doc; // 14b / 15b
  const hole = (pin: string) => ({ part: 'bb1', pin });
  doc = addWire(
    doc,
    { part: 'board', pin: 'D13' },
    hole('10e'),
    [
      [g(30), g(1)],
      [g(30), g(7)],
    ],
    'yellow',
  ).doc;
  doc = addWire(doc, hole('15a'), hole('tn13'), [], 'black').doc;
  doc = addWire(
    doc,
    hole('tn1'),
    { part: 'board', pin: 'GND3' },
    [
      [g(33), g(-2)],
      [g(9), g(-2)],
    ],
    'black',
  ).doc;
  return doc;
}
