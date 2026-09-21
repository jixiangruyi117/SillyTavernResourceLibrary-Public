import { AppDatabase } from '../database/AppDatabase'

// All lazy feature containers share the same connection and migrations.
export const appDatabase = new AppDatabase()
