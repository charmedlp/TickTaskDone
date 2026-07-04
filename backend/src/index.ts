import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors()); // dev : laisse le frontend Vite ET l'app Capacitor appeler l'API
app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
    console.log(`API en écoute sur http://localhost:${port}`);
});
