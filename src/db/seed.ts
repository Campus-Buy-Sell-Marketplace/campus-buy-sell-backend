import bcrypt from 'bcryptjs';
import pool from '../config/db';

async function seed(): Promise<void> {
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const testUsers = [
    {
      name: 'Alex Student',
      email: 'student@campus.edu',
      role: 'STUDENT',
      password: passwordHash,
    },
    {
      name: 'Sam Seller',
      email: 'seller@campus.edu',
      role: 'SELLER',
      password: passwordHash,
    },
    {
      name: 'Morgan Admin',
      email: 'admin@campus.edu',
      role: 'ADMIN',
      password: passwordHash,
    },
    {
      name: 'Taylor Super Admin',
      email: 'superadmin@campus.edu',
      role: 'SUPER_ADMIN',
      password: passwordHash,
    },
  ];

  console.log('🌱 Seeding test accounts for all 4 roles...\n');

  for (const user of testUsers) {
    await pool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           password = EXCLUDED.password,
           role = EXCLUDED.role`,
      [user.name, user.email, user.password, user.role]
    );
    console.log(`  ✓ ${user.role.padEnd(12)} -> ${user.email}`);
  }

  console.log('\n🎉 Done! Password for all test accounts: Password123!');
  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seeding failed:', err);
  pool.end();
  process.exit(1);
});
