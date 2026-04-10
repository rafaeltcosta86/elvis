import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../prisma', () => ({
  default: {
    contact: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../prisma';
import {
  findByAlias,
  findByName,
  addAlias,
  createContact,
  listContacts,
} from '../contactService';

const linic = {
  id: 'c1',
  name: 'Linic',
  phone: '5511988880000',
  aliases: ['/linic', 'linic'],
  created_at: new Date(),
};

beforeEach(() => vi.clearAllMocks());

describe('findByAlias', () => {
  it('returns contact when alias exists', async () => {
    (prisma.contact.findFirst as any).mockResolvedValue(linic);
    const result = await findByAlias('/linic');
    expect(result).toEqual(linic);
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { aliases: { has: '/linic' } },
    });
  });

  it('returns null when alias does not exist', async () => {
    (prisma.contact.findFirst as any).mockResolvedValue(null);
    const result = await findByAlias('/unknown');
    expect(result).toBeNull();
  });
});

describe('findByName', () => {
  it('returns contact by name (case-insensitive)', async () => {
    (prisma.contact.findFirst as any).mockResolvedValue(linic);
    const result = await findByName('linic');
    expect(result).toEqual(linic);
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'linic', mode: 'insensitive' } },
    });
  });

  it('returns null when name not found', async () => {
    (prisma.contact.findFirst as any).mockResolvedValue(null);
    expect(await findByName('desconhecido')).toBeNull();
  });
});

describe('addAlias', () => {
  it('adds new alias to existing contact', async () => {
    (prisma.contact.findFirst as any).mockResolvedValue(linic);
    const updated = { ...linic, aliases: [...linic.aliases, '/li'] };
    (prisma.contact.update as any).mockResolvedValue(updated);

    const result = await addAlias('Linic', '/li');

    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: linic.id },
      data: { aliases: { push: '/li' } },
    });
    expect(result).toEqual(updated);
  });

  it('throws if contact not found by name', async () => {
    (prisma.contact.findFirst as any).mockResolvedValue(null);
    await expect(addAlias('Desconhecido', '/d')).rejects.toThrow('not found');
  });
});

describe('createContact', () => {
  it('creates a new contact with aliases', async () => {
    (prisma.contact.create as any).mockResolvedValue(linic);
    const result = await createContact('Linic', '5511988880000', ['/linic']);
    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: { name: 'Linic', phone: '5511988880000', aliases: ['/linic'] },
    });
    expect(result).toEqual(linic);
  });
});

describe('listContacts', () => {
  it('returns all contacts', async () => {
    (prisma.contact.findMany as any).mockResolvedValue([linic]);
    const result = await listContacts();
    expect(result).toEqual([linic]);
  });
});
