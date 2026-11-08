import { namedNets } from '@robosim/circuit-canvas';
import type { BuildDiagnostic, ChatContext, ProjectDocument } from '@robosim/shared';
import {
  decodeSerial,
  type ChallengeNodeView,
  type ChallengeView,
  type Frame,
  type SerialChunk,
} from '@robosim/sim-runtime/client';

/**
 * What the editor sends with a question (FR-AI-01): the project as edited, its nets, the newest serial lines,
 * findings, compiler diagnostics and a short summary of the run. The server trims it to its token budget.
 */

/** Electrical nets that touch a wire or a seated leg (breadboard rows included), largest first. */
export function netsOf(doc: ProjectDocument): string[][] {
  return namedNets(doc).slice(0, 300);
}

/** Last lines the sketch printed, decoded at the rate it transmits at. */
export function serialTail(chunks: readonly SerialChunk[], lines = 60): string[] {
  if (chunks.length === 0) return [];
  const first = decodeSerial(chunks, 9600);
  const decoded =
    first.sketchBaud && first.sketchBaud !== 9600 ? decodeSerial(chunks, first.sketchBaud) : first;
  return decoded.lines.slice(-lines).map((l) => l.text.slice(0, 400));
}

function checks(
  node: ChallengeNodeView,
  label: (n: ChallengeNodeView) => string,
): { label: string; state: ChallengeNodeView['status'] }[] {
  if (node.children?.length) return node.children.flatMap((c) => checks(c, label));
  return [{ label: label(node), state: node.status }];
}

export function behaviourOf(
  live: Frame,
  challenge: ChallengeView | undefined,
  names: { challenge: string; node: (n: ChallengeNodeView) => string },
): NonNullable<ChatContext['behaviourSummary']> {
  return {
    running: live.running,
    simTimeS: Math.round(live.simTime * 100) / 100,
    ...(live.robot
      ? {
          pose: {
            x: Math.round(live.robot.x * 1000) / 1000,
            y: Math.round(live.robot.y * 1000) / 1000,
            headingDeg: Math.round((live.robot.angle * 180) / Math.PI),
          },
        }
      : {}),
    ...(challenge
      ? {
          challenge: {
            name: names.challenge.slice(0, 200),
            status: challenge.status === 'failure' ? 'failed' : challenge.status,
            checks: checks(challenge.tree, names.node)
              .slice(0, 30)
              .map((c) => ({ label: c.label.slice(0, 200), state: c.state })),
          },
        }
      : {}),
  };
}

export interface ContextInput {
  doc: ProjectDocument;
  currentFile?: string | undefined;
  serial: readonly SerialChunk[];
  findings: readonly { rule: string; severity: 'error' | 'warning' | 'info'; message: string }[];
  diagnostics: readonly BuildDiagnostic[];
  behaviour?: ChatContext['behaviourSummary'];
  guidedStep?: ChatContext['guidedStep'];
}

export function chatContext(input: ContextInput): ChatContext {
  const tail = serialTail(input.serial);
  const nets = netsOf(input.doc);
  return {
    document: input.doc,
    ...(input.currentFile ? { currentFile: input.currentFile } : {}),
    ...(nets.length ? { nets } : {}),
    ...(tail.length ? { serialTail: tail } : {}),
    ...(input.findings.length
      ? { findings: input.findings.slice(0, 50).map((f) => ({ ...f, message: f.message.slice(0, 600) })) }
      : {}),
    ...(input.diagnostics.length
      ? {
          diagnostics: input.diagnostics.slice(0, 50).map((d) => ({
            file: d.file,
            line: d.line,
            severity: d.severity,
            message: d.message.slice(0, 600),
          })),
        }
      : {}),
    ...(input.behaviour ? { behaviourSummary: input.behaviour } : {}),
    ...(input.guidedStep ? { guidedStep: input.guidedStep } : {}),
  };
}
