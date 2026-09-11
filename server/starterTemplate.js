// Lean starter applied to every new workspace: a few envelopes per group and one
// account, so a new budget is usable immediately without being overwhelming.
export const STARTER_GROUPS = [
  ['Housing', [['Rent or Mortgage', '🏠'], ['Utilities', '⚡']]],
  ['Transportation', [['Gas', '⛽'], ['Car', '🚗']]],
  ['Food', [['Groceries', '🛒'], ['Dining Out', '🍽️']]],
  ['Debt', [['Credit Card', '💳']]],
  ['Bills', [['Phone and Internet', '📶'], ['Subscriptions', '📺']]],
  ['Lifestyle', [['Fun Money', '💵'], ['Shopping', '🛍️']]],
  ['Savings', [['Emergency Fund', '🏦'], ['Savings Goal', '✈️']]],
]
export const STARTER_ACCOUNT = ['Checking', 'checking']

// Inserts the groups, categories, and one starter account for a workspace.
// All inserts are parameterized and scoped to workspaceId.
export function applyStarterTemplate(db, workspaceId) {
  const addGroup = db.prepare('INSERT INTO category_groups (workspace_id, name, sort_order) VALUES (?, ?, ?)')
  const addCat = db.prepare('INSERT INTO categories (group_id, name, emoji, sort_order) VALUES (?, ?, ?, ?)')
  STARTER_GROUPS.forEach(([groupName, cats], gi) => {
    const groupId = Number(addGroup.run(workspaceId, groupName, gi).lastInsertRowid)
    cats.forEach(([name, emoji], ci) => addCat.run(groupId, name, emoji, ci))
  })
  db.prepare('INSERT INTO accounts (workspace_id, name, type) VALUES (?, ?, ?)')
    .run(workspaceId, STARTER_ACCOUNT[0], STARTER_ACCOUNT[1])
}
