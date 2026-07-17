import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, pool } from './db';
import { user } from './schema';
import { createUserWithDefaults } from '../modules/user/user.service';

// Dev-only: ensures the hard-coded development user (used by the temporary
// `currentUser` middleware) exists, along with its personal workspace and owner
// membership. Idempotent. Run with `npm run db:seed`.
const developmentUserEmail = process.env.DEV_USER_EMAIL ?? 'dev@ticktaskdone.local';

const run = async (): Promise<void> => {
  const [existing] = await db.select().from(user).where(eq(user.email, developmentUserEmail)).limit(1);
  if (existing) {
    console.log(`Development user already exists: ${developmentUserEmail} (idUser=${existing.idUser}).`);
  } else {
    const { idUser, idWorkspace } = await createUserWithDefaults(developmentUserEmail);
    console.log(`Created development user ${developmentUserEmail} (idUser=${idUser}, idWorkspace=${idWorkspace}).`);
  }
  await pool.end();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
