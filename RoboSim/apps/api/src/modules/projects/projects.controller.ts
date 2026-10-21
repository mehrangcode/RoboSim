import {
  createProjectSchema,
  createVersionSchema,
  parseIfMatch,
  projectEtag,
  projectListQuerySchema,
  updateProjectSchema,
  type CreateVersionInput,
  type Project,
  type ProjectListQuery,
  type ProjectPage,
  type ProjectSummary,
  type ProjectVersion,
  type ProjectVersionSummary,
  type UpdateProjectInput,
} from '@robosim/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { CallerGuard, CallerScope, type Caller } from '../iam/index.js';
import { ProjectsService } from './projects.service.js';

/** API Spec §4.4. Mutations of the project need `If-Match` with the ETag from the last response. */
@Controller('projects')
@UseGuards(CallerGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(
    @CallerScope() caller: Caller,
    @Query({ schema: projectListQuerySchema }) query: ProjectListQuery,
  ): Promise<ProjectPage> {
    return this.projects.list(caller, query);
  }

  @Post()
  async create(
    @CallerScope() caller: Caller,
    @Body({ schema: createProjectSchema }) body: z.output<typeof createProjectSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Project> {
    return tagged(reply, await this.projects.create(caller, body), 201);
  }

  @Get(':id')
  async get(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Project> {
    return tagged(reply, await this.projects.get(caller, id));
  }

  @Patch(':id')
  async update(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body({ schema: updateProjectSchema }) body: UpdateProjectInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Project> {
    return tagged(reply, await this.projects.update(caller, id, parseIfMatch(ifMatch), body));
  }

  @Put(':id/document')
  async save(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() document: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProjectSummary> {
    return tagged(reply, await this.projects.saveDocument(caller, id, parseIfMatch(ifMatch), document));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<void> {
    await this.projects.remove(caller, id, parseIfMatch(ifMatch));
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Project> {
    return tagged(reply, await this.projects.restore(caller, id));
  }

  @Post(':id/duplicate')
  async duplicate(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Project> {
    return tagged(reply, await this.projects.duplicate(caller, id), 201);
  }

  @Get(':id/versions')
  versions(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Query('cursor') cursor: string | undefined,
  ): Promise<{ items: ProjectVersionSummary[]; nextCursor: string | null }> {
    return this.projects.listVersions(caller, id, undefined, cursor);
  }

  @Post(':id/versions')
  createVersion(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Body({ schema: createVersionSchema }) body: CreateVersionInput,
  ): Promise<ProjectVersionSummary> {
    return this.projects.createVersion(caller, id, body.label);
  }

  @Get(':id/versions/:vid')
  version(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Param('vid') vid: string,
  ): Promise<ProjectVersion> {
    return this.projects.getVersion(caller, id, vid);
  }

  @Post(':id/versions/:vid/restore')
  @HttpCode(200)
  async restoreVersion(
    @CallerScope() caller: Caller,
    @Param('id') id: string,
    @Param('vid') vid: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Project> {
    return tagged(reply, await this.projects.restoreVersion(caller, id, vid, parseIfMatch(ifMatch)));
  }
}

function tagged<T extends { revision: number }>(reply: FastifyReply, body: T, status?: number): T {
  void reply.header('etag', projectEtag(body.revision));
  if (status) void reply.status(status);
  return body;
}
