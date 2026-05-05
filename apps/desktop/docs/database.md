# Database (Drizzle ORM)

Detail doc for the Electron desktop app. Index: [../AGENTS.md](../AGENTS.md).

**Location:** `{userData}/data/agents.db` (SQLite)

**Schema:** `src/main/lib/db/schema/index.ts`

```typescript
// Core tables:
projects                  → id, name, path, git remote (provider/owner/repo), iconPath, timestamps
chats                     → id, name, projectId, worktreePath, branch, baseBranch, prUrl, prNumber, archivedAt, timestamps
sub_chats                 → id, name, chatId, sessionId, streamId, mode, messages (JSON),
                            cached fileStats {additions, deletions, fileCount}, timestamps

// Auth / accounts:
claude_code_credentials   → DEPRECATED single-row OAuth token store (kept for migration)
anthropic_accounts        → Multi-account OAuth tokens (encrypted via safeStorage)
anthropic_settings        → Singleton row tracking the active anthropic account
```

`chats.archivedAt` is set but `chats.list` filters it out; archived-chat listing/restoration endpoints have been removed.

**Auto-migration:** On app start, `initDatabase()` runs migrations from `drizzle/` folder (dev) or `resources/migrations` (packaged).

**Queries:**
```typescript
import { getDatabase, projects, chats } from "../lib/db"
import { eq } from "drizzle-orm"

const db = getDatabase()
const allProjects = db.select().from(projects).all()
const projectChats = db.select().from(chats).where(eq(chats.projectId, id)).all()
```
