// Usage: set -a; . ./.env.local; set +a; NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json scripts/phone-health.mts
// Prints the same report as the Phone health page, from the command line.
import { phoneHealth } from '@/lib/twilio/health'

const h = await phoneHealth()
console.log(JSON.stringify(h, null, 1))
