import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { ScopedDataAccess } from './scoped-data-access.service';

export interface MemberView {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

interface MembershipRow {
  id: string;
  userId: string;
  role: string;
  user: { name: string; email: string };
}

@Injectable()
export class MembershipsService {
  constructor(
    private readonly scoped: ScopedDataAccess,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(email: string, role: string): Promise<MemberView> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.scoped.findMany<{ id: string }>('orgMembership', {
      where: { userId: user.id },
      select: { id: true },
    });
    if (existing.length > 0) {
      throw new ConflictException('User is already a member of this organization');
    }

    const row = await this.scoped.create<{ id: string; role: string }>('orgMembership', {
      userId: user.id,
      role,
    });
    await this.audit.record('membership.create', 'OrgMembership', row.id, {
      email: user.email,
      role: row.role,
    });
    return { id: row.id, userId: user.id, name: user.name, email: user.email, role: row.role };
  }

  async list(): Promise<MemberView[]> {
    const rows = await this.scoped.findMany<MembershipRow>('orgMembership', {
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toView);
  }

  async updateRole(id: string, role: string): Promise<MemberView> {
    const current = await this.findRow(id);
    if (current.role === 'OWNER' && role !== 'OWNER') {
      await this.assertAnotherOwner();
    }
    const updated = await this.scoped.updateById('orgMembership', id, { role });
    if (!updated) {
      throw new NotFoundException('Member not found');
    }
    if (current.role !== role) {
      await this.audit.record('membership.role_change', 'OrgMembership', id, {
        email: current.user.email,
        from: current.role,
        to: role,
      });
    }
    return toView(current.role === role ? current : await this.findRow(id));
  }

  async remove(id: string): Promise<void> {
    const current = await this.findRow(id);
    if (current.role === 'OWNER') {
      await this.assertAnotherOwner();
    }
    const deleted = await this.scoped.deleteById('orgMembership', id);
    if (!deleted) {
      throw new NotFoundException('Member not found');
    }
    await this.audit.record('membership.delete', 'OrgMembership', id, {
      email: current.user.email,
      role: current.role,
    });
  }

  private async assertAnotherOwner(): Promise<void> {
    const owners = await this.scoped.findMany<{ id: string }>('orgMembership', {
      where: { role: 'OWNER' },
      select: { id: true },
    });
    if (owners.length <= 1) {
      throw new BadRequestException('An organization must keep at least one owner');
    }
  }

  private async findRow(id: string): Promise<MembershipRow> {
    const row = await this.scoped.findById<MembershipRow>('orgMembership', id, {
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Member not found');
    }
    return row;
  }

  async get(id: string): Promise<MemberView> {
    const row = await this.scoped.findById<MembershipRow>('orgMembership', id, {
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Member not found');
    }
    return toView(row);
  }
}

function toView(row: MembershipRow): MemberView {
  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    role: row.role,
  };
}
