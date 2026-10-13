import { PrismaPg } from '@prisma/adapter-pg';
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

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    await seedEquipment(prisma);
    await seedRooms(prisma);
    console.log(
      `Seeded ${EQUIPMENT.length} equipment items and ${ROOMS.length} rooms`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
