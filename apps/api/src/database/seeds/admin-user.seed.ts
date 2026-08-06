import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { Role, User } from '../entities';
import { RoleName } from '../../common/enums/roles.enum';

export async function seedAdminUser(dataSource: DataSource): Promise<void> {
  const userRepo = dataSource.getRepository(User);
  const roleRepo = dataSource.getRepository(Role);

  const email = process.env.ADMIN_EMAIL ?? 'admin@aether.local';
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

  const existing = await userRepo.findOne({ where: { email } });
  if (existing) {
    console.log(`Admin user ${email} already exists, skipping`);
    return;
  }

  const adminRole = await roleRepo.findOne({ where: { name: RoleName.ADMIN } });
  if (!adminRole) {
    throw new Error(
      'Admin role not found — run migrations first (roles are seeded by InitialSchema)',
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await userRepo.save(
    userRepo.create({
      email,
      fullName: 'AETHER Administrator',
      passwordHash,
      role: adminRole,
      isActive: true,
    }),
  );

  console.log(
    `Seeded admin user: ${email} / ${password} (change this password after first login)`,
  );
}
