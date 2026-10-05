import { ConflictException, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { UserEntity, UserRole } from '../database/entities';

export interface UserView {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
}

export const toUserView = (u: UserEntity): UserView => ({
  id: u.id,
  email: u.email,
  fullName: u.fullName,
  role: u.role,
  isActive: u.isActive,
  createdAt: u.createdAt,
});

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.config.bcryptRounds);
  }

  async create(input: { email: string; fullName: string; password: string; role: UserRole }): Promise<UserView> {
    const existing = await this.users.findOne({
      where: { email: input.email },
    });
    if (existing) throw new ConflictException('A user with this email already exists');
    const saved = await this.users.save(
      this.users.create({
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        passwordHash: await this.hashPassword(input.password),
      }),
    );
    return toUserView(saved);
  }

  async list(): Promise<UserView[]> {
    return (await this.users.find({ order: { createdAt: 'ASC' } })).map(toUserView);
  }

  async setActive(id: string, actorId: string, isActive: boolean): Promise<UserView> {
    if (id === actorId && !isActive) throw new BadRequestException('You cannot deactivate your own account');
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    user.isActive = isActive;
    return toUserView(await this.users.save(user));
  }

  /** Used by the first-run script: create the admin if there is none. */
  async ensureAdmin(email: string, fullName: string, password: string): Promise<{ created: boolean }> {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) return { created: false };
    await this.create({ email, fullName, password, role: 'admin' });
    return { created: true };
  }
}
