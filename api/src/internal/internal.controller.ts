import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Internal } from '../common/auth';
import { ClaimDto, ScreeningResultDto, StaleQuery } from './internal.dto';
import { InternalService } from './internal.service';

/**
 * Endpoints for the Lambda workers. Not reachable with a user token: every
 * request must carry an HMAC signature made with the shared secret.
 */
@ApiExcludeController()
@Controller('internal')
@Internal()
export class InternalController {
  constructor(private readonly internal: InternalService) {}

  @Get('applications/:id/screening-context')
  context(@Param('id', ParseUUIDPipe) id: string) {
    return this.internal.beginScreening(id);
  }

  @Post('applications/:id/screening')
  @HttpCode(200)
  result(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScreeningResultDto) {
    return this.internal.recordScreening(id, dto);
  }

  @Get('reports/stale-applications')
  stale(@Query() query: StaleQuery) {
    return this.internal.staleApplications(query.days ?? 7);
  }

  @Post('notifications/claim')
  @HttpCode(200)
  claim(@Body() dto: ClaimDto) {
    return this.internal.claim(dto.outboxId);
  }

  @Delete('notifications/claim/:outboxId')
  @HttpCode(204)
  async release(@Param('outboxId') outboxId: string) {
    await this.internal.release(outboxId);
  }
}
