import { UNO_PINS } from '@robosim/board-avr-uno/pins';
import { CATALOG_MANIFESTS, findManifest } from '@robosim/catalog/manifests';
import {
  applyCircuitChanges,
  applyCodeEdits,
  circuitChangeSchema,
  codeEditSchema,
  parseProjectDocument,
  ProjectDocumentError,
  ProposalError,
  unifiedDiff,
  uuidv7,
  type AiProposal,
  type CircuitChange,
  type PartResolver,
  type ProjectDocument,
} from '@robosim/shared';

/**
 * Turns a model's tool call into a proposal the editor can show (FR-AI-05): the edits must apply to the current
 * file, and the circuit changes must yield a valid document. A proposal that does not fit is not sent.
 */

export const PARTS: PartResolver = {
  part(type) {
    const m = findManifest(type);
    if (!m) return undefined;
    return {
      version: m.version,
      pins: m.pins.map((p) => p.name),
      props: Object.fromEntries(Object.entries(m.props).map(([k, spec]) => [k, spec.default])),
    };
  },
  boardPins: UNO_PINS.map((p) => p.id),
};

/** Part types a proposal may add: every catalogue part except mechanical bases. */
export const PART_TYPES: readonly string[] = CATALOG_MANIFESTS.filter((m) => m.category !== 'mechanical').map(
  (m) => m.id,
);

const KEYS: Record<CircuitChange['op'], readonly string[]> = {
  add_component: ['id', 'type', 'props'],
  remove_component: ['id'],
  set_prop: ['id', 'prop', 'value'],
  add_wire: ['from', 'to'],
  remove_wire: ['from', 'to'],
};

/** Keep only the fields the op uses: models fill unused ones with null or empty values. */
function normalizeChange(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const op = r.op as CircuitChange['op'];
  const keys = KEYS[op] as readonly string[] | undefined;
  if (!keys) return raw;
  return Object.fromEntries([
    ['op', op],
    ...keys.filter((k) => r[k] !== null && r[k] !== undefined).map((k) => [k, r[k]]),
  ]);
}

export type ProposalOutcome = { ok: true; proposal: AiProposal } | { ok: false; reason: string };

export function toProposal(name: string, args: unknown, doc: ProjectDocument | null): ProposalOutcome {
  if (!doc) return { ok: false, reason: 'no project was sent' };
  if (!args || typeof args !== 'object')
    return { ok: false, reason: 'the tool arguments were not valid JSON' };
  const a = args as Record<string, unknown>;
  const summary = typeof a.summary === 'string' ? a.summary.slice(0, 500) : '';
  try {
    if (name === 'propose_code_patch') {
      const file =
        doc.code.files.find((f) => f.name === a.file) ??
        (doc.code.files.length === 1 ? doc.code.files[0] : undefined);
      if (!file) return { ok: false, reason: `no file ${String(a.file)}` };
      // Small models sometimes flatten a single edit into the arguments, or send one edit object.
      const rawEdits =
        a.edits === undefined && typeof a.find === 'string'
          ? [{ find: a.find, replace: a.replace ?? '' }]
          : Array.isArray(a.edits) || a.edits === undefined
            ? a.edits
            : [a.edits];
      const edits = codeEditSchema.array().min(1).max(20).safeParse(rawEdits);
      if (!edits.success) return { ok: false, reason: 'the edits were malformed' };
      const after = applyCodeEdits(file.content, edits.data);
      const diff = unifiedDiff(file.name, file.content, after);
      if (!diff) return { ok: false, reason: 'the edits change nothing' };
      return {
        ok: true,
        proposal: {
          id: uuidv7(),
          kind: 'code_patch',
          summary,
          file: file.name,
          edits: edits.data,
          unifiedDiff: diff,
        },
      };
    }
    if (name === 'propose_circuit_change') {
      const changes = circuitChangeSchema
        .array()
        .min(1)
        .max(40)
        .safeParse(
          Array.isArray(a.changes)
            ? a.changes.map(normalizeChange)
            : a.changes === undefined && typeof a.op === 'string'
              ? [normalizeChange(a)]
              : a.changes,
        );
      if (!changes.success) {
        const issue = changes.error.issues[0];
        return {
          ok: false,
          reason: `the changes were malformed (${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''})`,
        };
      }
      parseProjectDocument(applyCircuitChanges(doc, changes.data, PARTS));
      return { ok: true, proposal: { id: uuidv7(), kind: 'circuit_change', summary, changes: changes.data } };
    }
    return { ok: false, reason: `unknown tool ${name}` };
  } catch (e) {
    if (e instanceof ProposalError) return { ok: false, reason: e.message };
    if (e instanceof ProjectDocumentError) return { ok: false, reason: e.issues[0] ?? e.message };
    throw e;
  }
}
