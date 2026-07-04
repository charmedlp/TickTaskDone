import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

// Route de vérification — confirme que le serveur répond.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`API en écoute sur http://localhost:${port}`);
});
