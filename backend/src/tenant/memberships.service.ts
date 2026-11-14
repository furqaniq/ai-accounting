import { Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(private readonly scoped: ScopedDataAccess) {}

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
