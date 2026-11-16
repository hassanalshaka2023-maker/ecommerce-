import {
  ConflictException,
  Injectable,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Role } from '../common/auth.js';
import { User } from './user.entity.js';
import { LoginDto, RegisterDto } from './users.dto.js';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
  ) {}

  // Creates the first admin on startup; there is deliberately no endpoint for it.
  async onModuleInit() {
    const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
    if (email && password && !(await this.users.existsBy({ email }))) {
      const passwordHash = await bcrypt.hash(password, 10);
      await this.users.save({
        name: 'Admin',
        email,
        passwordHash,
        role: Role.ADMIN,
      });
    }
  }

  async register({ name, email, password }: RegisterDto) {
    if (await this.users.existsBy({ email })) {
      throw new ConflictException('Email is already registered');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    return this.issueToken(
      await this.users.save({ name, email, passwordHash }),
    );
  }

  async login({ email, password }: LoginDto) {
    const user = await this.users.findOneBy({ email });
    // Same message for both cases, so attackers can't tell which emails exist.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueToken(user);
  }

  private issueToken({ id, name, email, role }: User) {
    return {
      accessToken: this.jwt.sign({ sub: id, role }),
      user: { id, name, email, role },
    };
  }
}
