import 'dotenv/config';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from './schema';

// Pool de connexions (concurrence + reconnexion automatique).
// mysql2 accepte l'URL via `uri` ; connectionLimit = 10 par défaut.
//
// timezone: 'Z' est CRITIQUE : une colonne MySQL DATETIME ne porte pas de fuseau.
// Sans cette option, mysql2 convertit les Date JS selon le fuseau local du process
// à l'écriture ET à la lecture, ce qui décalerait les valeurs. Toute la logique de
// récurrence génère des slots en UTC (rrule) ; on force donc mysql2 à écrire et
// relire les DATETIME en UTC, sinon un `occurrenceDate` relu ne correspondrait plus
// au slot virtuel généré et le masquage virtuel↔matérialisé se casserait (doublons).
const pool = mysql.createPool({ uri: process.env.DATABASE_URL!, timezone: 'Z' });

// `db` = l'interface Drizzle typée, posée par-dessus le pool.
export const db = drizzle({ client: pool, schema, mode: 'default' });

// Type de la transaction Drizzle (extrait du callback de db.transaction), pour
// écrire des helpers qui composent plusieurs écritures dans une même transaction.
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { pool };
