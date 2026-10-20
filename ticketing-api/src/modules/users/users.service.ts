import { Injectable } from '@nestjs/common';
import type { Prisma, Role, User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { PublicUser } from '../auth/dto/auth.dto.js';

export const toPublicUser = (user: Pick<User, 'id' | 'email' | 'name' | 'role' | 'status'>): PublicUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  status: user.status,
});

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, tx: Pick<Prisma.TransactionClient, 'user'> = this.prisma) {
    return tx.user.findUnique({ where: { id } });
  }

  findByEmailAndRole(email: string, role: Role) {
    return this.prisma.user.findUnique({ where: { email_role: { email: email.toLowerCase(), role } } });
  }
}
