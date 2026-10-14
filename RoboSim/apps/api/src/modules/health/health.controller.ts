import { DomainError } from '@robosim/shared';
import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { DATABASE, type Database } from '../../db/client.js';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Liveness: the process is running. Never checks dependencies, so a DB outage does not restart pods. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies needed to serve traffic are reachable. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.database.ping();
    } catch (error) {
      this.logger.error(`Readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new DomainError('maintenance', { dependency: 'database' });
    }
    return { status: 'ok' };
  }
}
