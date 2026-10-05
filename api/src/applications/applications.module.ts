import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { ApplicationsController, PublicApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [OutboxModule],
  controllers: [PublicApplicationsController, ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
