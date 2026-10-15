import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { DAY_MS, HOUR_MS } from '../src/common/utils/time';
import { PrismaClient } from '../src/generated/prisma/client';

const EQUIPMENT = ['Projector', 'Whiteboard', 'Video conferencing'] as const;

type EquipmentName = (typeof EQUIPMENT)[number];

interface RoomSeed {
  name: string;
  capacity: number;
  floor: number;
  equipment: EquipmentName[];
}

const ROOMS: RoomSeed[] = [
  {
    name: 'Kyiv',
    capacity: 12,
    floor: 1,
    equipment: ['Projector', 'Whiteboard', 'Video conferencing'],
  },
  {
    name: 'Lviv',
    capacity: 8,
    floor: 1,
    equipment: ['Whiteboard', 'Video conferencing'],
  },
  { name: 'Odesa', capacity: 6, floor: 2, equipment: ['Projector'] },
  { name: 'Kharkiv', capacity: 4, floor: 2, equipment: ['Whiteboard'] },
  {
    name: 'Dnipro',
    capacity: 10,
    floor: 2,
    equipment: ['Projector', 'Video conferencing'],
  },
  { name: 'Chernihiv', capacity: 2, floor: 3, equipment: [] },
  {
    name: 'Poltava',
    capacity: 16,
    floor: 3,
    equipment: ['Projector', 'Whiteboard', 'Video conferencing'],
  },
  {
    name: 'Uzhhorod',
    capacity: 6,
    floor: 3,
    equipment: ['Video conferencing'],
  },
];

// The only way to get an admin: registration through the API always creates a member.
// Re-running the seed resets the admin's role and password to the values from .env
async function seedAdmin(prisma: PrismaClient): Promise<string> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 8) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters) must be set',
    );
  }

  const passwordHash = await argon2.hash(password);
  await prisma.user.upsert({
    where: { email },
    update: { role: 'admin', passwordHash },
    create: { email, name: 'Admin', role: 'admin', passwordHash },
  });

  return email;
}

async function seedEquipment(prisma: PrismaClient): Promise<void> {
  for (const name of EQUIPMENT) {
    await prisma.equipment.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

async function seedRooms(prisma: PrismaClient): Promise<void> {
  for (const room of ROOMS) {
    await prisma.room.upsert({
      where: { name: room.name },
      update: {},
      create: {
        name: room.name,
        capacity: room.capacity,
        floor: room.floor,
        equipment: {
          create: room.equipment.map((name) => ({
            equipment: { connect: { name } },
          })),
        },
      },
    });
  }
}

// Optional large data set (SEED_BULK=true) to check index usage with EXPLAIN ANALYZE:
// on a table with a handful of rows Postgres always prefers a sequential scan.
const BULK_ROOMS = 5000;
const BULK_EQUIPMENT = 20;
const BULK_EQUIPMENT_PER_ROOM = 2;
const BULK_USERS = 200;
const BULK_BOOKINGS_PER_ROOM = 20;
const BULK_BOOKINGS_FROM = Date.UTC(2026, 8, 1);
const BULK_INSERT_CHUNK = 5000;
const BULK_INSERT_TIMEOUT_MS = 10 * 60 * 1000;

async function seedBulk(prisma: PrismaClient): Promise<void> {
  const equipmentNames = Array.from(
    { length: BULK_EQUIPMENT },
    (_, i) => `Bulk equipment ${String(i + 1).padStart(2, '0')}`,
  );
  await prisma.equipment.createMany({
    data: equipmentNames.map((name) => ({ name })),
    skipDuplicates: true,
  });
  const equipment = await prisma.equipment.findMany({
    where: { name: { in: equipmentNames } },
    orderBy: { name: 'asc' },
    select: { id: true },
  });

  const roomNames = Array.from(
    { length: BULK_ROOMS },
    (_, i) => `Bulk room ${String(i + 1).padStart(5, '0')}`,
  );
  await prisma.room.createMany({
    data: roomNames.map((name, i) => ({
      name,
      capacity: 2 + (i % 39),
      floor: -2 + (i % 33),
    })),
    skipDuplicates: true,
  });
  const rooms = await prisma.room.findMany({
    where: { name: { in: roomNames } },
    orderBy: { name: 'asc' },
    select: { id: true },
  });

  await prisma.roomEquipment.createMany({
    data: rooms.flatMap((room, i) =>
      Array.from({ length: BULK_EQUIPMENT_PER_ROOM }, (_, j) => ({
        roomId: room.id,
        equipmentId: equipment[(i + j * 7) % BULK_EQUIPMENT].id,
      })),
    ),
    skipDuplicates: true,
  });

  console.log(
    `Seeded ${BULK_EQUIPMENT} bulk equipment items and ${BULK_ROOMS} bulk rooms`,
  );

  await seedBulkBookings(prisma, rooms);
}

async function seedBulkBookings(
  prisma: PrismaClient,
  rooms: { id: string }[],
): Promise<void> {
  // Only the bookings of the bulk users count: a real booking that happens to be
  // titled "Bulk booking ..." must not make the seed think it has already run
  const existing = await prisma.booking.count({
    where: {
      title: { startsWith: 'Bulk booking' },
      user: { email: { startsWith: 'bulk-user-' } },
    },
  });
  if (existing > 0) {
    console.log(`Bulk bookings already exist (${existing}), skipped`);
    return;
  }

  const passwordHash = await argon2.hash(randomUUID());
  const emails = Array.from(
    { length: BULK_USERS },
    (_, i) => `bulk-user-${String(i + 1).padStart(3, '0')}@seed.local`,
  );
  await prisma.user.createMany({
    data: emails.map((email, i) => ({
      email,
      name: `Bulk user ${i + 1}`,
      passwordHash,
    })),
    skipDuplicates: true,
  });
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    orderBy: { email: 'asc' },
    select: { id: true },
  });

  const bookings = rooms.flatMap((room, i) =>
    Array.from({ length: BULK_BOOKINGS_PER_ROOM }, (_, k) => {
      const day = k * 3 + (i % 3);
      const hour = 8 + ((i + k) % 10);
      const startsAt = new Date(
        BULK_BOOKINGS_FROM + day * DAY_MS + hour * HOUR_MS,
      );
      return {
        title: `Bulk booking ${k + 1}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR_MS),
        status:
          (i + k) % 10 === 0 ? ('cancelled' as const) : ('confirmed' as const),
        attendeesCount: 2,
        roomId: room.id,
        userId: users[(i + k * 7) % users.length].id,
      };
    }),
  );
  // One transaction: an interrupted run leaves no bookings behind, so the next
  // run starts from scratch instead of skipping a partial data set
  await prisma.$transaction(
    async (tx) => {
      for (let i = 0; i < bookings.length; i += BULK_INSERT_CHUNK) {
        await tx.booking.createMany({
          data: bookings.slice(i, i + BULK_INSERT_CHUNK),
        });
      }
    },
    { timeout: BULK_INSERT_TIMEOUT_MS },
  );

  console.log(
    `Seeded ${users.length} bulk users and ${bookings.length} bulk bookings`,
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const adminEmail = await seedAdmin(prisma);
    console.log(`Seeded admin ${adminEmail}`);

    await seedEquipment(prisma);
    await seedRooms(prisma);
    console.log(
      `Seeded ${EQUIPMENT.length} equipment items and ${ROOMS.length} rooms`,
    );

    if (process.env.SEED_BULK === 'true') {
      await seedBulk(prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
