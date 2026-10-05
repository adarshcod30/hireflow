import { Body, Controller, Get, HttpCode, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Transform } from 'class-transformer';
import { trimLower } from '../common/transforms';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { Repository } from 'typeorm';
import { Auth, AuthUser, CurrentUser } from '../common/auth';
import { rateLimit } from '../common/rate-limit';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { UserEntity } from '../database/entities';
import { toUserView } from '../users/users.service';

export class LoginDto {
  @Transform(trimLower)
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  // Compared against when the email is unknown, so "no such user" and "wrong
  // password" cost the same time and give the same answer.
  private readonly dummyHash: string;

  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.dummyHash = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({
    default: { limit: rateLimit('RATE_LIMIT_LOGIN', 5), ttl: 60_000 },
  })
  async login(@Body() dto: LoginDto) {
    const user = await this.users.findOne({ where: { email: dto.email } });
    const matches = await bcrypt.compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !matches || !user.isActive) throw new UnauthorizedException('Invalid email or password');

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      typ: 'access',
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.jwtExpiresIn,
      user: toUserView(user),
    };
  }

  @Get('me')
  @ApiBearerAuth()
  @Auth()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
