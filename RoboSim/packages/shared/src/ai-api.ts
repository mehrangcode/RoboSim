import { z } from 'zod';
import { localeSchema } from './locale.js';
import { pinRefSchema } from './project-schema.js';

/**
 * AI assistant contract (FR-AI-01…05, 07…09; API Spec §4.11; Technical Design §13).
 *
 * `platform` is the deployment's own open-weight model (Ollama / vLLM, ADR-009); the others are
 * bring-your-own-key adapters, each enabled per deployment by staff after legal review (BR-15).
 */
export const AI_PROVIDERS = [
  'platform',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'compatible',
] as const;
export const aiProviderIdSchema = z.enum(AI_PROVIDERS);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;
export const BYOK_PROVIDERS = AI_PROVIDERS.filter((p) => p !== 'platform') as Exclude<
  AiProviderId,
  'platform'
>[];

export const AI_KEY_SCOPES = ['user', 'workspace'] as const;
export const aiKeyScopeSchema = z.enum(AI_KEY_SCOPES);
export type AiKeyScope = z.infer<typeof aiKeyScopeSchema>;

export const AI_KEY_STATUSES = ['pending', 'active', 'invalid'] as const;
export type AiKeyStatus = (typeof AI_KEY_STATUSES)[number];

/** A stored key as the API shows it: never the key itself, only its last four characters (US-AI-04 AC2). */
export const aiKeySchema = z.object({
  provider: aiProviderIdSchema,
  scope: aiKeyScopeSchema,
  last4: z.string(),
  status: z.enum(AI_KEY_STATUSES),
  baseUrl: z.string().nullable(),
  /** The provider's message when the test call failed. */
  error: z.string().nullable(),
  validatedAt: z.string().nullable(),
});
export type AiKey = z.infer<typeof aiKeySchema>;

export const putAiKeyRequestSchema = z.strictObject({
  key: z.string().trim().min(8).max(500),
  /** Required for `compatible`; optional override for `openrouter`/`openai` proxies the deployment allows. */
  baseUrl: z
    .url({ protocol: /^https?$/ })
    .max(300)
    .optional(),
  scope: aiKeyScopeSchema.default('user'),
});
export type PutAiKeyRequest = z.input<typeof putAiKeyRequestSchema>;

export const aiModelSchema = z.object({ id: z.string(), label: z.string() });
export type AiModel = z.infer<typeof aiModelSchema>;
export const aiModelListSchema = z.object({ items: z.array(aiModelSchema) });

/** Why a provider cannot be used by the caller right now (the UI explains each). */
export const AI_PROVIDER_BLOCKS = [
  'key_missing',
  'key_invalid',
  'byok_not_in_plan',
  'minor_platform_only',
] as const;

export const aiProviderSchema = z.object({
  id: aiProviderIdSchema,
  platform: z.boolean(),
  usable: z.boolean(),
  blockedBy: z.enum(AI_PROVIDER_BLOCKS).nullable(),
  defaultModel: z.string().nullable(),
  /** Keys the caller can use for this provider (user key first). */
  keys: z.array(aiKeySchema),
});
export type AiProvider = z.infer<typeof aiProviderSchema>;
export const aiProviderListSchema = z.object({ providers: z.array(aiProviderSchema) });

/** What the robot did, summarised in the browser from the live run (FR-AI-01). */
export const behaviourSummarySchema = z.strictObject({
  running: z.boolean(),
  simTimeS: z.number().nonnegative(),
  pose: z.strictObject({ x: z.number(), y: z.number(), headingDeg: z.number() }).optional(),
  distanceM: z.number().nonnegative().optional(),
  collisions: z.number().int().nonnegative().optional(),
  challenge: z
    .strictObject({
      name: z.string().max(200),
      status: z.enum(['running', 'success', 'failed']),
      checks: z
        .array(z.strictObject({ label: z.string().max(200), state: z.enum(['pending', 'met', 'failed']) }))
        .max(30),
    })
    .optional(),
});
export type BehaviourSummary = z.infer<typeof behaviourSummarySchema>;

export const aiFindingSchema = z.strictObject({
  rule: z.string().max(80),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string().max(600),
});
export const aiDiagnosticSchema = z.strictObject({
  file: z.string().max(200),
  line: z.number().int().nonnegative(),
  severity: z.enum(['error', 'warning', 'note']),
  message: z.string().max(600),
});

/** The context the editor sends with each question; the server trims it to the token budget. */
export const chatContextSchema = z.strictObject({
  /** The document as edited (unsaved changes included); validated and summarised server-side. */
  document: z.unknown().optional(),
  /** Electrical nets from the editor (breadboard rows included), each a list of `part:pin`. */
  nets: z
    .array(z.array(z.string().max(80)).max(100))
    .max(300)
    .optional(),
  /** File the user is looking at. */
  currentFile: z.string().max(200).optional(),
  serialTail: z.array(z.string().max(400)).max(200).optional(),
  behaviourSummary: behaviourSummarySchema.optional(),
  findings: z.array(aiFindingSchema).max(50).optional(),
  diagnostics: z.array(aiDiagnosticSchema).max(50).optional(),
  guidedStep: z.strictObject({ title: z.string().max(200), instructions: z.string().max(4000) }).optional(),
});
export type ChatContext = z.infer<typeof chatContextSchema>;

export const chatRequestSchema = z.strictObject({
  projectId: z.uuid().optional(),
  conversationId: z.uuid().optional(),
  provider: aiProviderIdSchema.optional(),
  model: z.string().max(120).optional(),
  message: z.string().trim().min(1).max(4000),
  locale: localeSchema.optional(),
  context: chatContextSchema.default({}),
});
export type ChatRequest = z.input<typeof chatRequestSchema>;

/** A code edit: replace one exact, unique occurrence of `find` (empty `find` appends). */
export const codeEditSchema = z.strictObject({
  find: z.string().max(20_000),
  replace: z.string().max(20_000),
});
export type CodeEdit = z.infer<typeof codeEditSchema>;

/** One circuit change, at the level the editor works (parts, props, wires), not raw document paths. */
export const circuitChangeSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('add_component'),
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    type: z.string().min(1).max(80),
    props: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional(),
  }),
  z.strictObject({ op: z.literal('remove_component'), id: z.string().min(1).max(64) }),
  z.strictObject({
    op: z.literal('set_prop'),
    id: z.string().min(1).max(64),
    prop: z.string().min(1).max(64),
    value: z.union([z.number(), z.boolean(), z.string()]),
  }),
  z.strictObject({ op: z.literal('add_wire'), from: pinRefSchema, to: pinRefSchema }),
  z.strictObject({ op: z.literal('remove_wire'), from: pinRefSchema, to: pinRefSchema }),
]);
export type CircuitChange = z.infer<typeof circuitChangeSchema>;

export const aiProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: z.string(),
    kind: z.literal('code_patch'),
    summary: z.string().max(500),
    file: z.string(),
    edits: z.array(codeEditSchema).min(1).max(20),
    /** For display; the edits are re-applied to the file as it is when the user presses Apply. */
    unifiedDiff: z.string(),
  }),
  z.strictObject({
    id: z.string(),
    kind: z.literal('circuit_change'),
    summary: z.string().max(500),
    changes: z.array(circuitChangeSchema).min(1).max(40),
  }),
]);
export type AiProposal = z.infer<typeof aiProposalSchema>;

/** Server-sent events of `POST /ai/chat`. */
export type ChatEvent =
  | { event: 'start'; data: { conversationId: string; provider: AiProviderId; model: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'proposal'; data: AiProposal }
  | { event: 'filtered'; data: { category: string } }
  | { event: 'usage'; data: AiUsageDelta }
  | { event: 'done'; data: { messageId: string } }
  | { event: 'error'; data: { code: string; message?: string } };

export const aiUsageDeltaSchema = z.object({
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  /** Platform tokens left this month; null with a BYOK key or an unlimited plan. */
  remaining: z.number().int().nullable(),
});
export type AiUsageDelta = z.infer<typeof aiUsageDeltaSchema>;

export const aiMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  proposals: z.array(aiProposalSchema),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  filtered: z.boolean(),
  createdAt: z.string(),
});
export type AiMessage = z.infer<typeof aiMessageSchema>;

export const aiConversationSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
});
export type AiConversation = z.infer<typeof aiConversationSchema>;
export const aiConversationListSchema = z.object({ items: z.array(aiConversationSchema) });
export const aiConversationDetailSchema = aiConversationSchema.extend({ messages: z.array(aiMessageSchema) });
export type AiConversationDetail = z.infer<typeof aiConversationDetailSchema>;

export const aiUsageSchema = z.object({
  /** Monthly platform allowance in tokens; null = unlimited. */
  allowance: z.number().int().nullable(),
  used: z.number().int().nonnegative(),
  remaining: z.number().int().nullable(),
  resetsAt: z.string(),
  rateLimit: z.object({ perMinute: z.number().int(), perDay: z.number().int() }),
  /** History is kept this many days (30 for minors, 90 for adults). */
  historyDays: z.number().int(),
});
export type AiUsage = z.infer<typeof aiUsageSchema>;

// ---- Back office (FR-ADM-08) ----

export const aiProviderConfigSchema = z.object({
  provider: aiProviderIdSchema,
  enabled: z.boolean(),
  baseUrl: z.string().nullable(),
  /** Models users may pick; empty = every model the provider lists. */
  models: z.array(z.string()),
  defaultModel: z.string().nullable(),
  legalRef: z.string().nullable(),
  legalApprovedAt: z.string().nullable(),
  /** Price per million tokens in rials (input, output) for the cost column; null = not priced. */
  priceInIrr: z.number().int().nonnegative().nullable(),
  priceOutIrr: z.number().int().nonnegative().nullable(),
  check: z.object({ at: z.string(), ok: z.boolean(), error: z.string().nullable() }).nullable(),
  updatedAt: z.string(),
});
export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;
export const aiProviderConfigListSchema = z.object({ items: z.array(aiProviderConfigSchema) });

export const updateAiProviderConfigSchema = z.strictObject({
  enabled: z.boolean(),
  baseUrl: z
    .url({ protocol: /^https?$/ })
    .max(300)
    .nullable()
    .optional(),
  models: z.array(z.string().min(1).max(120)).max(100).optional(),
  defaultModel: z.string().min(1).max(120).nullable().optional(),
  /** Legal review reference; required to enable an external provider (BR-15). */
  legalRef: z.string().trim().min(1).max(200).nullable().optional(),
  priceInIrr: z.number().int().nonnegative().nullable().optional(),
  priceOutIrr: z.number().int().nonnegative().nullable().optional(),
});
export type UpdateAiProviderConfig = z.input<typeof updateAiProviderConfigSchema>;

export const aiUsageReportRowSchema = z.object({
  provider: z.string(),
  model: z.string(),
  requests: z.number().int(),
  users: z.number().int(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  /** Estimated cost in rials from the provider's prices; null when unpriced. */
  costIrr: z.number().nullable(),
  avgLatencyMs: z.number().int(),
});
export const aiUsageReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  rows: z.array(aiUsageReportRowSchema),
});
export type AiUsageReport = z.infer<typeof aiUsageReportSchema>;
