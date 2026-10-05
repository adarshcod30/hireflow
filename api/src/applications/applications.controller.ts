import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Auth, AuthUser, CurrentUser } from '../common/auth';
import { rateLimit } from '../common/rate-limit';
import { ApplicationListQuery, ApplyDto, TransitionDto } from './applications.dto';
import { ApplicationsService } from './applications.service';

@ApiTags('public')
@Controller('public')
export class PublicApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post('jobs/:jobId/applications')
  @Throttle({
    default: { limit: rateLimit('RATE_LIMIT_APPLY', 10), ttl: 60_000 },
  })
  async apply(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: ApplyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.applications.apply(jobId, dto);
    // 201 for a new application, 200 when it already existed
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Post('applications/:id/resume-upload-url')
  @HttpCode(200)
  @Throttle({
    default: { limit: rateLimit('RATE_LIMIT_APPLY', 10), ttl: 60_000 },
  })
  async uploadUrl(@Param('id', ParseUUIDPipe) id: string, @Headers('x-application-token') token: string | undefined) {
    return {
      resumeUpload: await this.applications.reissueUploadTicket(id, token),
    };
  }
}

@ApiTags('applications')
@ApiBearerAuth()
@Controller()
@Auth('admin', 'recruiter')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get('jobs/:jobId/applications')
  list(@Param('jobId', ParseUUIDPipe) jobId: string, @Query() query: ApplicationListQuery) {
    return this.applications.listForJob(jobId, query);
  }

  @Get('applications/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.applications.get(id);
  }

  @Patch('applications/:id/status')
  transition(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionDto, @CurrentUser() user: AuthUser) {
    return this.applications.transition(id, user.id, dto);
  }

  @Get('applications/:id/resume-url')
  resumeUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.applications.resumeDownloadUrl(id);
  }
}
