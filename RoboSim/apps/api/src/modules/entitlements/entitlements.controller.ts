import {
  createOverrideSchema,
  createPlanVersionSchema,
  planCodeSchema,
  setSubscriptionSchema,
  type AdminPlan,
  type AdminPlanList,
  type AdminWorkspace,
  type AdminWorkspaceList,
  type MeEntitlements,
  type PlanList,
  type StaffMe,
} from '@robosim/shared';
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DATABASE, type Database } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { withSystem } from '../../db/scope.js';
import {
  CallerGuard,
  CallerScope,
  requireStaff,
  StaffGuard,
  StaffScope,
  type Caller,
  type Staff,
} from '../iam/index.js';
import {
  BillingAdminService,
  type CreateOverride,
  type CreatePlanVersion,
  type SetSubscription,
} from './billing-admin.service.js';
import { EntitlementsService } from './entitlements.service.js';

/** API Spec §4.1, §4.9: the caller's entitlements and the public plan catalogue. */
@Controller()
export class EntitlementsController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly admin: BillingAdminService,
  ) {}

  @Get('me/entitlements')
  @UseGuards(CallerGuard)
  me(@CallerScope() caller: Caller): Promise<MeEntitlements> {
    return this.entitlements.me(caller.workspaceId, caller.userId);
  }

  /** Public: what each self-serve plan includes (the plans page and paywalls). */
  @Get('plans')
  async plans(): Promise<PlanList> {
    return { items: await this.admin.publicPlans() };
  }
}

const searchSchema = z.object({ q: z.string().trim().max(200).default('') });

/** Back office (API Spec §4.13): staff only, each route checks its permission. */
@Controller('admin')
@UseGuards(StaffGuard)
export class BillingAdminController {
  constructor(
    private readonly admin: BillingAdminService,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  @Get('me')
  async me(@StaffScope() staff: Staff): Promise<StaffMe> {
    const [user] = await withSystem(this.database.db, (tx) =>
      tx
        .select({ email: users.email, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, staff.userId)),
    );
    return {
      userId: staff.userId,
      email: user?.email ?? null,
      displayName: user?.displayName ?? '',
      roles: staff.roles,
    };
  }

  @Get('plans')
  async plans(@StaffScope() staff: Staff): Promise<AdminPlanList> {
    requireStaff(staff, 'read');
    return { items: await this.admin.listPlans() };
  }

  @Post('plans/:code/versions')
  publishVersion(
    @StaffScope() staff: Staff,
    @Param('code') code: string,
    @Body({ schema: createPlanVersionSchema }) body: CreatePlanVersion,
  ): Promise<AdminPlan> {
    requireStaff(staff, 'plans');
    return this.admin.publishVersion(staff, planCodeSchema.parse(code), body);
  }

  @Get('workspaces')
  async workspaces(
    @StaffScope() staff: Staff,
    @Query({ schema: searchSchema }) query: z.output<typeof searchSchema>,
  ): Promise<AdminWorkspaceList> {
    requireStaff(staff, 'read');
    return { items: await this.admin.searchWorkspaces(query.q) };
  }

  @Get('workspaces/:id')
  workspace(@StaffScope() staff: Staff, @Param('id') id: string): Promise<AdminWorkspace> {
    requireStaff(staff, 'read');
    return this.admin.getWorkspace(id);
  }

  @Put('workspaces/:id/subscription')
  setSubscription(
    @StaffScope() staff: Staff,
    @Param('id') id: string,
    @Body({ schema: setSubscriptionSchema }) body: SetSubscription,
  ): Promise<AdminWorkspace> {
    requireStaff(staff, 'subscriptions');
    return this.admin.setSubscription(staff, id, body);
  }

  @Post('workspaces/:id/overrides')
  addOverride(
    @StaffScope() staff: Staff,
    @Param('id') id: string,
    @Body({ schema: createOverrideSchema }) body: CreateOverride,
  ): Promise<AdminWorkspace> {
    requireStaff(staff, 'overrides');
    return this.admin.addOverride(staff, id, body);
  }

  @Delete('workspaces/:id/overrides/:overrideId')
  removeOverride(
    @StaffScope() staff: Staff,
    @Param('id') id: string,
    @Param('overrideId') overrideId: string,
  ): Promise<AdminWorkspace> {
    requireStaff(staff, 'overrides');
    return this.admin.removeOverride(staff, id, overrideId);
  }
}
