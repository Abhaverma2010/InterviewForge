// In-memory store with the same interface as the MongoDB store. Used by the
// tests, and handy for trying the API without a database.
//
// Store interface (see mongo.js for the real one):
//   users.create({ email, passwordHash })       → user | throws { code: 'EMAIL_TAKEN' }
//   users.findByEmail(email)                    → user with passwordHash | null
//   users.findById(id)                          → user | null
//   kits.create(record)                         → record
//   kits.get(id)                                → record | null
//   kits.listByOwner(owner)                     → records, newest first
//   kits.findByHash(owner, hash)                → newest record with that input hash | null
//   kits.update(id, patch)                      → record | null
//   kits.updateIfVersion(id, version, patch)    → record, or null if the version moved on
//   kits.setCardProgress(id, cardId, progress)  → record | null
//   kits.remove(id)                             → boolean
//   kits.findUnfinished()                       → records still queued or generating

import { randomUUID } from 'node:crypto';

export function createMemoryStore() {
  const users = new Map();
  const kits = new Map();
  const clone = (v) => (v == null ? v : structuredClone(v));
  const publicUser = ({ passwordHash, ...user }) => user;

  return {
    users: {
      async create({ email, passwordHash }) {
        if ([...users.values()].some((u) => u.email === email)) {
          throw Object.assign(new Error('Email already registered'), { code: 'EMAIL_TAKEN' });
        }
        const user = {
          id: randomUUID(),
          email,
          passwordHash,
          created_at: new Date().toISOString(),
        };
        users.set(user.id, user);
        return publicUser(clone(user));
      },
      async findByEmail(email) {
        return clone([...users.values()].find((u) => u.email === email) ?? null);
      },
      async findById(id) {
        const user = users.get(id);
        return user ? publicUser(clone(user)) : null;
      },
    },

    kits: {
      async create(record) {
        const now = new Date().toISOString();
        const stored = { ...clone(record), id: randomUUID(), created_at: now, updated_at: now };
        kits.set(stored.id, stored);
        return clone(stored);
      },
      async get(id) {
        return clone(kits.get(id) ?? null);
      },
      async listByOwner(owner) {
        return [...kits.values()]
          .filter((k) => k.owner === owner)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map(clone);
      },
      async findByHash(owner, hash) {
        const matches = [...kits.values()].filter(
          (k) => k.owner === owner && k.input_hash === hash,
        );
        matches.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return clone(matches[0] ?? null);
      },
      async update(id, patch) {
        const current = kits.get(id);
        if (!current) return null;
        Object.assign(current, clone(patch), { updated_at: new Date().toISOString() });
        return clone(current);
      },
      async updateIfVersion(id, version, patch) {
        const current = kits.get(id);
        if (!current || current.version !== version) return null;
        Object.assign(current, clone(patch), {
          version: version + 1,
          updated_at: new Date().toISOString(),
        });
        return clone(current);
      },
      async setCardProgress(id, cardId, progress) {
        const current = kits.get(id);
        if (!current) return null;
        current.practice = { cards: { ...current.practice?.cards, [cardId]: clone(progress) } };
        return clone(current);
      },
      async remove(id) {
        return kits.delete(id);
      },
      async findUnfinished() {
        return [...kits.values()]
          .filter((k) => k.status === 'queued' || k.status === 'generating')
          .map(clone);
      },
    },

    async close() {},
  };
}
