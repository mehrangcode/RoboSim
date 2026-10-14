import { Controller, Get } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service.js';

@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  /** Flags evaluated for the current context; user/workspace context is added with authentication in P2. */
  @Get()
  async list(): Promise<{ flags: Record<string, boolean> }> {
    return { flags: await this.flags.evaluateAll() };
  }
}
