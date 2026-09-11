// Seeds workspace 1 (the pre-multi-tenant "Personal" workspace) with the lean
// starter template so a fresh install has a usable budget from the start.
// Run once: npm run seed
import { db } from './db.js'
import { applyStarterTemplate } from './starterTemplate.js'

const alreadySeeded = db
  .prepare('SELECT COUNT(*) AS n FROM category_groups WHERE workspace_id = 1').get().n > 0
if (alreadySeeded) {
  console.error('Workspace 1 already has envelopes. Seeding would duplicate them, so nothing was changed.')
  process.exit(1)
}

db.exec('BEGIN')
applyStarterTemplate(db, 1)
db.exec('COMMIT')

console.log('Seeded the starter template into workspace 1.')
