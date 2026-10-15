import { Module } from '@nestjs/common';
import { BuildGatewayController } from './build-gateway.controller.js';
import { BuildGatewayService } from './build-gateway.service.js';

@Module({
  controllers: [BuildGatewayController],
  providers: [BuildGatewayService],
  exports: [BuildGatewayService],
})
export class BuildGatewayModule {}
