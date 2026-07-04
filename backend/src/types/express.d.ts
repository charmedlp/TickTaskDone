import type { Item } from '../db/schema';
import type { CurrentUser } from '../middleware/currentUser';

// Request augmentation for the properties our middlewares attach.
declare global {
  namespace Express {
    interface Request {
      currentUser: CurrentUser; // set by `currentUser`
      workspaceId: number; // set by `scopeWorkspace`
      loadedItem: Item; // set by `loadItem` on nested occurrence routes
    }
  }
}

export {};
