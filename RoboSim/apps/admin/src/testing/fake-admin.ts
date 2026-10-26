import {
  DEFAULT_PLAN_ENTITLEMENTS,
  createOverrideSchema,
  mergeEntitlements,
  type AdminPlan,
  type AdminPriceList,
  type AdminWorkspace,
  type EntitlementGrant,
  type ErrorCode,
  type StaffMe,
} from '@robosim/shared';
import type { AdminClient } from '../lib/admin-api.js';
import { ApiError } from '../lib/api.js';

export const problem = (code: ErrorCode, status: number, title: string = code) =>
  new ApiError({ type: code, title, status, code, requestId: 'test' });

export const ADMIN: StaffMe = {
  userId: '01920000-0000-7000-8000-0000000000f1',
  email: 'ops@example.com',
  displayName: 'Nima Ops',
  roles: ['platform_admin'],
};
export const SUPPORT: StaffMe = { ...ADMIN, displayName: 'Sima Support', roles: ['support_agent'] };

const OWNER_ID = '01920000-0000-7000-8000-000000000001';
export const WORKSPACE_ID = '01920000-0000-7000-8000-000000000002';

function plans(): AdminPlan[] {
  return [
    {
      code: 'free',
      public: true,
      versions: [
        {
          id: 'pv-free-2',
          version: 2,
          interval: 'month',
          priceIrr: null,
          entitlements: DEFAULT_PLAN_ENTITLEMENTS.free,
          effectiveFrom: '2026-10-01T00:00:00.000Z',
          effectiveTo: null,
          subscribers: 1200,
        },
        {
          id: 'pv-free-1',
          version: 1,
          interval: 'month',
          priceIrr: null,
          entitlements: { ...DEFAULT_PLAN_ENTITLEMENTS.free, 'build.daily_quota': 20 },
          effectiveFrom: '2026-09-01T00:00:00.000Z',
          effectiveTo: '2026-10-01T00:00:00.000Z',
          subscribers: 0,
        },
      ],
    },
    {
      code: 'maker',
      public: true,
      versions: [
        {
          id: 'pv-maker-1',
          version: 1,
          interval: 'month',
          priceIrr: 2_500_000,
          entitlements: DEFAULT_PLAN_ENTITLEMENTS.maker,
          effectiveFrom: '2026-09-01T00:00:00.000Z',
          effectiveTo: null,
          subscribers: 42,
        },
      ],
    },
  ];
}

function workspace(): AdminWorkspace {
  return {
    id: WORKSPACE_ID,
    name: 'Sara’s robots',
    kind: 'personal',
    ownerId: OWNER_ID,
    ownerEmail: 'sara@example.com',
    ownerName: 'Sara',
    subscription: { plan: 'free', version: 2, status: 'active', periodEnd: null, source: null },
    effective: DEFAULT_PLAN_ENTITLEMENTS.free,
    overrides: [],
    liveProjects: 2,
  };
}

/** In-memory back-office API: one staff member (or a 401/403), two plans and one workspace; calls are recorded. */
export class FakeAdmin implements AdminClient {
  readonly calls: { method: string; args: unknown[] }[] = [];
  /** `null` with `meError` simulates the gate cases. */
  staff: StaffMe | null;
  meError: ApiError | null = null;
  planList = plans();
  ws = workspace();
  priceList: AdminPriceList = {
    parts: [
      { key: 'board:avr-uno', kind: 'board', category: null, nameKey: null, variantProps: [] },
      {
        key: 'driver.l298n',
        kind: 'part',
        category: 'driver',
        nameKey: 'driver.l298n.name',
        variantProps: [],
      },
      {
        key: 'passive.resistor',
        kind: 'part',
        category: 'passive',
        nameKey: 'passive.resistor.name',
        variantProps: ['ohms'],
      },
      { key: 'consumable.jumper-mf', kind: 'jumper', category: null, nameKey: null, variantProps: [] },
    ],
    items: [
      {
        partKey: 'driver.l298n',
        priceIrr: 1_850_000,
        stock: 'in_stock',
        updatedAt: '2026-10-20T08:00:00.000Z',
      },
    ],
    asOf: '2026-10-20T08:00:00.000Z',
  };
  private nextOverride = 1;

  constructor(staff: StaffMe | null = ADMIN, meError?: ApiError) {
    this.staff = staff;
    if (meError) this.meError = meError;
  }

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  callsTo(method: string): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  me = async () => {
    if (this.meError) throw this.meError;
    if (!this.staff) throw problem('unauthenticated', 401);
    return this.staff;
  };

  login: AdminClient['login'] = async (input) => {
    this.record('login', input);
    if (input.password !== 'staff pass 42')
      throw problem('invalid_credentials', 401, 'Wrong email or password');
    this.meError = null;
    this.staff = ADMIN;
  };

  logout = async () => {
    this.record('logout');
    this.staff = null;
    this.meError = null;
  };

  plans = async () => this.planList;

  publishPlanVersion: AdminClient['publishPlanVersion'] = async (code, input) => {
    this.record('publishPlanVersion', code, input);
    const plan = this.planList.find((p) => p.code === code);
    if (!plan) throw problem('not_found', 404);
    const now = '2026-10-24T10:00:00.000Z';
    const updated: AdminPlan = {
      ...plan,
      versions: [
        {
          id: `pv-${code}-new`,
          version: (plan.versions[0]?.version ?? 0) + 1,
          interval: input.interval,
          priceIrr: input.priceIrr,
          entitlements: input.entitlements,
          effectiveFrom: now,
          effectiveTo: null,
          subscribers: 0,
        },
        ...plan.versions.map((v) => (v.effectiveTo ? v : { ...v, effectiveTo: now })),
      ],
    };
    this.planList = this.planList.map((p) => (p.code === code ? updated : p));
    return updated;
  };

  searchWorkspaces: AdminClient['searchWorkspaces'] = async (q) => {
    this.record('searchWorkspaces', q);
    const { effective: _e, overrides: _o, liveProjects: _l, ...summary } = this.ws;
    const hay = `${summary.name} ${summary.ownerName} ${summary.ownerEmail ?? ''}`.toLowerCase();
    return !q || hay.includes(q.toLowerCase()) ? [summary] : [];
  };

  workspace: AdminClient['workspace'] = async (id) => {
    if (id !== this.ws.id) throw problem('not_found', 404, 'Workspace not found');
    return this.ws;
  };

  setSubscription: AdminClient['setSubscription'] = async (id, input) => {
    this.record('setSubscription', id, input);
    if (input.plan === 'free') {
      this.ws = {
        ...this.ws,
        subscription: { plan: 'free', version: 2, status: 'active', periodEnd: null, source: null },
      };
      return this.recompute();
    }
    this.ws = {
      ...this.ws,
      subscription: {
        plan: input.plan,
        version: 1,
        status: 'active',
        periodEnd: input.periodEnd ?? null,
        source: 'staff',
      },
    };
    return this.recompute();
  };

  grantOverride: AdminClient['grantOverride'] = async (id, input) => {
    this.record('grantOverride', id, input);
    const parsed = createOverrideSchema.parse(input);
    this.ws = {
      ...this.ws,
      overrides: [
        ...this.ws.overrides,
        {
          id: `ov-${this.nextOverride++}`,
          userId: parsed.userId,
          key: parsed.key,
          value: parsed.value,
          reason: parsed.reason,
          grantedBy: ADMIN.userId,
          expiresAt: parsed.expiresAt,
          createdAt: '2026-10-24T10:00:00.000Z',
        },
      ],
    };
    return this.recompute();
  };

  removeOverride: AdminClient['removeOverride'] = async (id, overrideId) => {
    this.record('removeOverride', id, overrideId);
    this.ws = { ...this.ws, overrides: this.ws.overrides.filter((o) => o.id !== overrideId) };
    return this.recompute();
  };

  private recompute(): AdminWorkspace {
    const plan = this.ws.subscription.plan;
    const base = DEFAULT_PLAN_ENTITLEMENTS[plan === 'private_cloud' ? 'institution' : plan];
    const grants = this.ws.overrides.map((o) => ({ [o.key]: o.value }) as EntitlementGrant);
    this.ws = { ...this.ws, effective: mergeEntitlements(base, grants) };
    return this.ws;
  }

  prices = async () => this.priceList;

  setPrice: AdminClient['setPrice'] = async (partKey, input) => {
    this.record('setPrice', partKey, input);
    const row = { partKey, ...input, updatedAt: '2026-10-25T10:00:00.000Z' };
    const items = this.priceList.items.filter((p) => p.partKey !== partKey);
    this.priceList = {
      ...this.priceList,
      items: [...items, row].sort((a, b) => a.partKey.localeCompare(b.partKey)),
      asOf: row.updatedAt,
    };
    return row;
  };

  removePrice: AdminClient['removePrice'] = async (partKey) => {
    this.record('removePrice', partKey);
    this.priceList = { ...this.priceList, items: this.priceList.items.filter((p) => p.partKey !== partKey) };
  };
}
