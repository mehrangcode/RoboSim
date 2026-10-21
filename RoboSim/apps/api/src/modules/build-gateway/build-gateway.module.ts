import { Module } from '@nestjs/common';
import { IamModule } from '../iam/index.js';
import { ProjectsModule } from '../projects/index.js';
import { BuildGatewayController } from './build-gateway.controller.js';
import { BuildGatewayService } from './build-gateway.service.js';

@Module({
  imports: [IamModule, ProjectsModule],
  controllers: [BuildGatewayController],
  providers: [BuildGatewayService],
  exports: [BuildGatewayService],
})
export class BuildGatewayModule {}
