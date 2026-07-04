import 'dotenv/config';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema';

// Pool de connexions (concurrence + reconnexion automatique).
// mysql2 accepte directement la chaîne de connexion ; connectionLimit = 10 par défaut.
const pool = mysql.createPool(process.env.DATABASE_URL!);

// `db` = l'interface Drizzle typée, posée par-dessus le pool.
export const db = drizzle({ client: pool, schema, mode: 'default' });

export { pool };
