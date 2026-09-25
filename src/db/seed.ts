import bcrypt from 'bcryptjs';
import pool from '../config/db';

async function seed(): Promise<void> {
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const testUsers = [
    // Admins
    {
      name: 'Taylor Super Admin',
      email: 'superadmin@campus.edu',
      role: 'SUPER_ADMIN',
      password: passwordHash,
    },
    {
      name: 'Morgan Admin',
      email: 'admin@campus.edu',
      role: 'ADMIN',
      password: passwordHash,
    },
    // Sellers
    {
      name: 'Sam Seller',
      email: 'seller@campus.edu',
      role: 'SELLER',
      password: passwordHash,
    },
    {
      name: 'Sneha Desai',
      email: 'sneha.desai@campus.edu',
      role: 'SELLER',
      password: passwordHash,
    },
    {
      name: 'Vikram Rao',
      email: 'vikram.rao@campus.edu',
      role: 'SELLER',
      password: passwordHash,
    },
    // Students / Buyers
    {
      name: 'Alex Student',
      email: 'student@campus.edu',
      role: 'STUDENT',
      password: passwordHash,
    },
    {
      name: 'Rahul Sharma',
      email: 'rahul.sharma@campus.edu',
      role: 'STUDENT',
      password: passwordHash,
    },
    {
      name: 'Priya Patel',
      email: 'priya.patel@campus.edu',
      role: 'STUDENT',
      password: passwordHash,
    },
    {
      name: 'Ananya Iyer',
      email: 'ananya.iyer@campus.edu',
      role: 'STUDENT',
      password: passwordHash,
    },
    {
      name: 'Rohan Kulkarni',
      email: 'rohan.kulkarni@campus.edu',
      role: 'STUDENT',
      password: passwordHash,
    },
  ];

  console.log('🌱 Seeding users into Neon PostgreSQL...\n');

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
    console.log(`  ✓ ${user.role.padEnd(12)} -> ${user.email} (${user.name})`);
  }

  // Seed sample seller applications for demonstration
  console.log('\n🌱 Seeding sample seller applications...');

  // 1. Rahul Sharma -> PENDING application
  const rahulRes = await pool.query(`SELECT id FROM users WHERE email = 'rahul.sharma@campus.edu'`);
  if (rahulRes.rows.length > 0) {
    await pool.query(
      `INSERT INTO seller_applications (user_id, business_name, description, contact_number, status)
       VALUES ($1, $2, $3, $4, 'PENDING')
       ON CONFLICT (user_id) DO UPDATE
       SET business_name = EXCLUDED.business_name,
           description = EXCLUDED.description,
           contact_number = EXCLUDED.contact_number,
           status = 'PENDING'`,
      [
        rahulRes.rows[0].id,
        "Rahul's Tech & Lab Gear",
        'Selling Arduino starter kits, Raspberry Pi 4, digital multimeter, and 3rd semester circuit lab components.',
        '+91 98450 12345',
      ]
    );
    console.log(`  ✓ PENDING Application -> Rahul Sharma (Rahul's Tech & Lab Gear)`);
  }

  // 2. Priya Patel -> PENDING application
  const priyaRes = await pool.query(`SELECT id FROM users WHERE email = 'priya.patel@campus.edu'`);
  if (priyaRes.rows.length > 0) {
    await pool.query(
      `INSERT INTO seller_applications (user_id, business_name, description, contact_number, status)
       VALUES ($1, $2, $3, $4, 'PENDING')
       ON CONFLICT (user_id) DO UPDATE
       SET business_name = EXCLUDED.business_name,
           description = EXCLUDED.description,
           contact_number = EXCLUDED.contact_number,
           status = 'PENDING'`,
      [
        priyaRes.rows[0].id,
        "Priya's Campus Books",
        'Computer Science core textbooks: Data Structures in C++, Operating Systems (Galvin), Database Concepts, and handwritten lecture notes.',
        '+91 99887 65432',
      ]
    );
    console.log(`  ✓ PENDING Application -> Priya Patel (Priya's Campus Books)`);
  }

  // 3. Sneha Desai -> APPROVED application
  const snehaRes = await pool.query(`SELECT id FROM users WHERE email = 'sneha.desai@campus.edu'`);
  if (snehaRes.rows.length > 0) {
    await pool.query(
      `INSERT INTO seller_applications (user_id, business_name, description, contact_number, status)
       VALUES ($1, $2, $3, $4, 'APPROVED')
       ON CONFLICT (user_id) DO UPDATE
       SET business_name = EXCLUDED.business_name,
           description = EXCLUDED.description,
           contact_number = EXCLUDED.contact_number,
           status = 'APPROVED'`,
      [
        snehaRes.rows[0].id,
        "Sneha's Art & Stationery",
        'Engineering drawing boards, drafters, acrylic paints, sketchbooks, and stationery sets.',
        '+91 91234 56789',
      ]
    );
    console.log(`  ✓ APPROVED Application -> Sneha Desai (Sneha's Art & Stationery)`);
  }

  console.log('\n🎉 Done! Password for all seeded accounts: Password123!');
  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Seeding failed:', err);
  pool.end();
  process.exit(1);
});
