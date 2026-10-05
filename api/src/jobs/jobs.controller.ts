import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthUser, CurrentUser } from '../common/auth';
import { CreateJobDto, JobListQuery, PublicJobListQuery, UpdateJobDto } from './jobs.dto';
import { JobsService } from './jobs.service';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
@Auth('admin', 'recruiter')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobDto) {
    return this.jobs.create(user.id, dto);
  }

  @Get()
  list(@Query() query: JobListQuery) {
    return this.jobs.listForRecruiters(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateJobDto) {
    return this.jobs.update(id, dto);
  }
}

@ApiTags('public')
@Controller('public/jobs')
export class PublicJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@Query() query: PublicJobListQuery) {
    return this.jobs.listPublic(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.getPublic(id);
  }
}
