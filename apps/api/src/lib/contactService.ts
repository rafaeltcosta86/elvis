import prisma from './prisma';
import type { Contact } from '@prisma/client';

export async function findByAlias(alias: string): Promise<Contact | null> {
  return prisma.contact.findFirst({ where: { aliases: { has: alias } } });
}

export async function findByName(name: string): Promise<Contact | null> {
  return prisma.contact.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
}

export async function addAlias(contactName: string, alias: string): Promise<Contact> {
  const contact = await findByName(contactName);
  if (!contact) throw new Error(`Contact "${contactName}" not found`);
  return prisma.contact.update({
    where: { id: contact.id },
    data: { aliases: { push: alias } },
  });
}

export async function createContact(
  name: string,
  phone: string,
  aliases: string[]
): Promise<Contact> {
  return prisma.contact.create({ data: { name, phone, aliases } });
}

export async function listContacts(): Promise<Contact[]> {
  return prisma.contact.findMany();
}
