// MongoDB store (via Mongoose), with the same interface as memory.js.
//
// A kit record holds the generation job and the kit together:
//   owner, input_hash, input { jd, company_url, days },
//   status 'queued' | 'generating' | 'ready' | 'failed',
//   progress { step, steps: [...] }, error { code, message },
//   kit (the Appendix A document, stored as-is),
//   version (bumped on every user edit; optimistic concurrency),
//   practice { cards: { f1: { box, last_rating, ... } } }
//
// The kit is stored as one document rather than normalised into collections:
// it is always read and written whole, validated as a whole, and must match
// the Appendix A shape exactly, so a document database fits it naturally.

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

const kitSchema = new mongoose.Schema(
  {
    owner: { type: String, required: true, index: true },
    input_hash: { type: String, required: true },
    input: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['queued', 'generating', 'ready', 'failed'], required: true },
    progress: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
    kit: { type: mongoose.Schema.Types.Mixed, default: null },
    version: { type: Number, default: 0 },
    practice: { type: mongoose.Schema.Types.Mixed, default: () => ({ cards: {} }) },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    minimize: false, // keep empty objects such as practice.cards
  },
);
kitSchema.index({ owner: 1, input_hash: 1, created_at: -1 });
kitSchema.index({ status: 1 });

export async function createMongoStore(uri) {
  const connection = await mongoose
    .createConnection(uri, { serverSelectionTimeoutMS: 10_000 })
    .asPromise();
  const User = connection.model('User', userSchema);
  const Kit = connection.model('Kit', kitSchema);
  await Promise.all([User.init(), Kit.init()]); // build indexes, incl. the unique email

  const toUser = (doc) =>
    doc && { id: String(doc._id), email: doc.email, created_at: iso(doc.created_at) };
  const toKit = (doc) => {
    if (!doc) return null;
    const { _id, __v, created_at, updated_at, ...rest } = doc;
    return { id: String(_id), ...rest, created_at: iso(created_at), updated_at: iso(updated_at) };
  };
  const validId = (id) => mongoose.isValidObjectId(id);

  return {
    connection,

    users: {
      async create({ email, passwordHash }) {
        try {
          return toUser(await User.create({ email, passwordHash }));
        } catch (err) {
          if (err.code === 11000) {
            throw Object.assign(new Error('Email already registered'), { code: 'EMAIL_TAKEN' });
          }
          throw err;
        }
      },
      async findByEmail(email) {
        const doc = await User.findOne({ email }).lean();
        return doc && { ...toUser(doc), passwordHash: doc.passwordHash };
      },
      async findById(id) {
        return validId(id) ? toUser(await User.findById(id).lean()) : null;
      },
    },

    kits: {
      async create(record) {
        const doc = await Kit.create(record);
        return toKit(doc.toObject());
      },
      async get(id) {
        return validId(id) ? toKit(await Kit.findById(id).lean()) : null;
      },
      async listByOwner(owner) {
        return (await Kit.find({ owner }).sort({ created_at: -1 }).lean()).map(toKit);
      },
      async findByHash(owner, hash) {
        return toKit(
          await Kit.findOne({ owner, input_hash: hash }).sort({ created_at: -1 }).lean(),
        );
      },
      async update(id, patch) {
        if (!validId(id)) return null;
        return toKit(await Kit.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean());
      },
      async updateIfVersion(id, version, patch) {
        if (!validId(id)) return null;
        // Atomic compare-and-set: only succeeds if nobody saved in between.
        const doc = await Kit.findOneAndUpdate(
          { _id: id, version },
          { $set: patch, $inc: { version: 1 } },
          { new: true },
        ).lean();
        return toKit(doc);
      },
      async setCardProgress(id, cardId, progress) {
        if (!validId(id) || !/^f\d+$/.test(cardId)) return null;
        return toKit(
          await Kit.findByIdAndUpdate(
            id,
            { $set: { [`practice.cards.${cardId}`]: progress } },
            { new: true },
          ).lean(),
        );
      },
      async remove(id) {
        if (!validId(id)) return false;
        return (await Kit.deleteOne({ _id: id })).deletedCount === 1;
      },
      async findUnfinished() {
        return (await Kit.find({ status: { $in: ['queued', 'generating'] } }).lean()).map(toKit);
      },
    },

    async close() {
      await connection.close();
    },
  };
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}
