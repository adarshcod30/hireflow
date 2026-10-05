import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimLower } from '../common/transforms';
import { Auth, AuthUser, CurrentUser } from '../common/auth';
import { UserRole } from '../database/entities';
import { UsersService } from './users.service';

export class CreateUserDto {
  @Transform(trimLower)
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @MaxLength(128)
  password!: string;

  @IsIn(['admin', 'recruiter'])
  role!: UserRole;
}

export class SetActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Auth('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  list() {
    return this.users.list();
  }

  @Patch(':id/active')
  setActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActiveDto, @CurrentUser() actor: AuthUser) {
    return this.users.setActive(id, actor.id, dto.isActive);
  }
}
