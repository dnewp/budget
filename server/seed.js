// Seeds the envelope structure and regular payees from a first pass over several months of
// bank history. Targets are monthly averages, rounded to something a person would
// actually choose. Run once: npm run seed
import { db } from './db.js'

// [name, emoji, target cents, period]. Period defaults to monthly when omitted.
const GROUPS = [
  ['Housing', [
    ['Rent or Mortgage', '🏠', 155000],
    ['Power', '⚡', 22000],
    // Monthly, and seasonal: runs higher across the warmer months.
    // Funded a little above the yearly average so mild months build a cushion
    // for hot ones. The Averaging figure will refine this once data builds up.
    ['Water', '💧', 16000],
    ['Natural Gas', '🔥', 3000],
    ['Trash', '🗑️', 7200, 'quarterly'],
    ['House Cleaning', '🧹', 24000],
    // A bucket, not a bill: keep a float on hand for repairs and top it back up
    // after spending. Empty today, so it reads as needing the full amount.
    ['Home Maintenance', '🔨', 100000, 'balance'],
  ]],
  ['Auto and Transport', [
    // Fuel and convenience stores run a bit higher some months, but the daily
    // gas station run is budgeted separately below.
    ['Gas and Fuel', '⛽', 30000],
    ['Auto Insurance', '🚗', 38000],
    ['Roadside Assistance', '🛡️', 1500],
    ['Car Maintenance', '🔧', 6000],
    ['Car Registration', '🪪', 6000, 'yearly'],
  ]],
  // Split three ways because lunch at work and going out are different habits
  // with different fixes. Targets are recent monthly averages.
  ['Food', [
    ['Groceries', '🛒', 42000],
    // Includes the office market.
    ['Work Lunch', '🥪', 35000],
    ['Going Out', '🍽️', 40000],
  ]],
  ['Debt Payments', [
    ['Credit Card A', '💳', 70000],
    ['Credit Card B', '💳', 42000],
    ['Credit Card C', '💳', 35000],
    ['Credit Card D', '💳', 25000],
    ['Credit Card E', '💳', 15000],
    ['Credit Card F', '💳', 10000],
    ['Personal Loan', '🏍️', 15000],
  ]],
  // 0% installment plans on specific purchases, not revolving debt. Kept apart so
  // they never distort the debt picture. Payments get routed to the envelope for
  // whatever was bought as they come in.
  ['Payment Plans', [
    ['Installment Plan A', '🧾', 11000],
    ['Installment Plan B', '💵', 2000],
  ]],
  ['Subscriptions', [
    ['Internet', '📶', 6000],
    ['Streaming Video', '📺', 3700],
    ['Music Streaming', '🎵', 1100],
    ['Creative Software', '🎨', 2000],
    ['Productivity Suite', '🪟', 1000],
    ['Chat App', '💬', 1000],
    ['Delivery Membership', '🛵', 1000],
    ['AI Assistant', '🤖', 2000],
    ['Cloud Hosting', '☁️', 1200],
    ['Gym Membership', '💪', 2800],
  ]],
  ['Lifestyle', [
    ['Gaming', '🎮', 6000],
    // Pay as you go rather than a subscription, so no target: fund it when the
    // mood strikes instead of setting money aside every month.
    ['Hobby Fund', '⚙️', 0],
    ['Entertainment', '🎟️', 10000],
    ['Pets', '🐕', 8500],
    ['Clothing', '👕', 7500],
    ['Dry Cleaning', '🧺', 3500],
    // Includes the daily walking-around spending: coffee, snacks, incidentals.
    ['Spending Money', '💵', 8500],
  ]],
  ['Savings and Goals', [
    ['Savings', '🏦', 20000],
    ['Investing', '📈', 12500],
    ['Travel Fund', '✈️', 150000, 'balance'],
    ['Family Fund', '💝', 10000],
    // A bucket, not a bill: keep some on hand so a birthday never needs planning.
    ['Gifts', '🎁', 25000, 'balance'],
  ]],
]

// Regular vendors, each pointing at the envelope it normally belongs to so that
// picking the payee fills the envelope in for you.
const PAYEES = {
  'Gas Station A': 'Gas and Fuel',
  'Gas Station B': 'Gas and Fuel',
  'Gas Station C': 'Gas and Fuel',
  'Gas Station D': 'Gas and Fuel',
  'Car Wash A': 'Car Maintenance',
  'Car Wash B': 'Car Maintenance',
  'Local Auto Shop': 'Car Maintenance',
  'DMV': 'Car Registration',
  'Grocery Store A': 'Groceries',
  'Grocery Store B': 'Groceries',
  'Grocery Delivery': 'Groceries',
  'Warehouse Club': 'Groceries',
  'Cafe Near Work': 'Work Lunch',
  'Fast Food A': 'Work Lunch',
  'Fast Food B': 'Work Lunch',
  'Fast Food C': 'Work Lunch',
  'Fast Food D': 'Work Lunch',
  'Coffee Shop': 'Work Lunch',
  'Fast Casual A': 'Work Lunch',
  'Office Market': 'Work Lunch',
  'Restaurant A': 'Going Out',
  'Restaurant B': 'Going Out',
  'Restaurant C': 'Going Out',
  'Brewery A': 'Going Out',
  'Steakhouse Chain': 'Going Out',
  'Restaurant D': 'Going Out',
  'Brewery B': 'Going Out',
  'Bowling Alley': 'Entertainment',
  'Local Ballpark': 'Entertainment',
  'Game Storefront': 'Gaming',
  'Game Publisher A': 'Gaming',
  'Game Publisher B': 'Gaming',
  'Home Improvement Store': 'Home Maintenance',
  'Pest Control Co': 'Home Maintenance',
  'Online Retailer': 'Spending Money',
  'Big Box Store': 'Spending Money',
  'Pet Supply Store': 'Pets',
  'Tailor Shop': 'Clothing',
  'Dry Cleaner': 'Dry Cleaning',
  'Mortgage Servicer': 'Rent or Mortgage',
  'Power Utility': 'Power',
  'Water Utility': 'Water',
  'Gas Utility': 'Natural Gas',
  'Waste Services': 'Trash',
  'Cleaning Service': 'House Cleaning',
  'ISP': 'Internet',
  'Video Streaming Co': 'Streaming Video',
  'Music Streaming Co': 'Music Streaming',
  'Creative Software Co': 'Creative Software',
  'Productivity Software Co': 'Productivity Suite',
  'Chat App Co': 'Chat App',
  'Delivery App': 'Delivery Membership',
  'AI Vendor': 'AI Assistant',
  'Hobby Platform': 'Hobby Fund',
  'Cloud Host': 'Cloud Hosting',
  'Gym Chain': 'Gym Membership',
  'Insurance Co A': 'Roadside Assistance',
  'Insurance Co B': 'Auto Insurance',
  'Installment Provider A': 'Installment Plan A',
  'Installment Provider B': 'Installment Plan B',
  'Retail Card A': 'Credit Card A',
  'Retail Card B': 'Credit Card B',
  'Retail Card C': 'Credit Card C',
  'Retail Card D': 'Credit Card D',
  'Brokerage': 'Investing',
  'Rideshare App': 'Spending Money',
  'Donation Recipient': 'Spending Money',
  'Home Network Vendor': 'Spending Money',
  'P2P Payments': null,
  'Paycheck': null,
  'Benefits Payment': null,
}

const ACCOUNTS = [
  ['Primary Checking', 'checking'],
  ['Card A', 'credit'],
  ['Card B', 'credit'],
  ['Card C', 'credit'],
  ['Card D', 'credit'],
]

if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n > 0) {
  console.error('Envelopes already exist. Seeding would duplicate them, so nothing was changed.')
  process.exit(1)
}

db.exec('BEGIN')

const addGroup = db.prepare('INSERT INTO category_groups (name, sort_order) VALUES (?, ?)')
const addCategory = db.prepare(
  `INSERT INTO categories (group_id, name, emoji, target_cents, target_period, sort_order)
   VALUES (?, ?, ?, ?, ?, ?)`
)
const categoryIds = new Map()
const SPREAD = { monthly: 1, quarterly: 3, yearly: 12 }
let total = 0
let buckets = 0

GROUPS.forEach(([groupName, categories], groupIndex) => {
  const groupId = Number(addGroup.run(groupName, groupIndex).lastInsertRowid)
  categories.forEach(([name, icon, target, period = 'monthly'], i) => {
    const id = Number(addCategory.run(groupId, name, icon, target, period, i).lastInsertRowid)
    categoryIds.set(name, id)
    // Compare like with like: a quarterly bill costs a third of it per month. A
    // bucket is a one-time float to build up, not a recurring monthly cost.
    if (period === 'balance') buckets += target
    else total += Math.ceil(target / SPREAD[period])
  })
})

const addPayee = db.prepare('INSERT INTO payees (workspace_id, name, last_category_id) VALUES (1, ?, ?)')
for (const [payee, categoryName] of Object.entries(PAYEES)) {
  if (categoryName && !categoryIds.has(categoryName)) {
    throw new Error(`Payee "${payee}" points at unknown envelope "${categoryName}"`)
  }
  addPayee.run(payee, categoryName ? categoryIds.get(categoryName) : null)
}

const addAccount = db.prepare('INSERT INTO accounts (name, type) VALUES (?, ?)')
for (const [name, type] of ACCOUNTS) addAccount.run(name, type)

db.exec('COMMIT')

console.log(`Created ${categoryIds.size} envelopes in ${GROUPS.length} groups.`)
console.log(`Seeded ${Object.keys(PAYEES).length} payees and ${ACCOUNTS.length} accounts.`)
console.log(`Recurring monthly cost of all targets: $${(total / 100).toFixed(2)}.`)
console.log(`Plus $${(buckets / 100).toFixed(2)} of buckets to build up over time.`)
