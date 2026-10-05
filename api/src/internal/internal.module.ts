import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { InternalService } from './internal.service';

@Module({ controllers: [InternalController], providers: [InternalService] })
export class InternalModule {}
