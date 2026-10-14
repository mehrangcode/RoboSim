import { Module } from '@nestjs/common';
import { OutboxRelay } from './outbox.relay.js';
import { OutboxService } from './outbox.service.js';

@Module({ providers: [OutboxService, OutboxRelay], exports: [OutboxService, OutboxRelay] })
export class OutboxModule {}
