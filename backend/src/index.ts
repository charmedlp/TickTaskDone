import 'dotenv/config';
import express, { Router } from 'express';
import cors from 'cors';
import { currentUser } from './middleware/currentUser';
import { scopeWorkspace } from './middleware/scopeWorkspace';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { categoryRouter } from './modules/category/category.routes';
import { projectRouter } from './modules/project/project.routes';
import { itemRouter } from './modules/item/item.routes';
import { timeBlockRouter } from './modules/timeBlock/timeBlock.routes';
import { occurrenceRouter, reminderRouter } from './modules/occurrence/occurrence.routes';
import { scheduledItemRouter } from './modules/scheduledItem/scheduledItem.routes';
import { backlogRouter } from './modules/backlog/backlog.routes';

const app = express();
app.use(cors()); // dev : laisse le frontend Vite ET l'app Capacitor appeler l'API
app.use(express.json());

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

// Everything under a workspace resolves the current user, then enforces
// membership, before reaching the definitional modules (all workspace-scoped).
const workspaceRouter = Router({ mergeParams: true });
workspaceRouter.use('/categories', categoryRouter);
workspaceRouter.use('/projects', projectRouter);
workspaceRouter.use('/items', itemRouter);
workspaceRouter.use('/scheduled-items', scheduledItemRouter);
workspaceRouter.use('/timeblocks', timeBlockRouter);
workspaceRouter.use('/occurrences', occurrenceRouter);
workspaceRouter.use('/reminders', reminderRouter);
workspaceRouter.use('/backlog', backlogRouter);
app.use('/workspaces/:workspaceId', currentUser, scopeWorkspace, workspaceRouter);

// Unmatched routes and centralized error handling — must come last.
app.use(notFoundHandler);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`API en écoute sur http://localhost:${port}`);
});
