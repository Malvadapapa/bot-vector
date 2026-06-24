import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;

if (!url || !token) {
  console.error("Missing Turso URL or Auth Token");
  process.exit(1);
}

const client = createClient({ url, authToken: token });

async function run() {
  try {
    console.log("Connecting to Turso...");
    
    const teachers = await client.execute("SELECT * FROM managed_teachers WHERE LOWER(email) LIKE '%ramiro%'");
    console.log("\n=== MANAGED TEACHERS IN TURSO ===");
    console.log(teachers.rows);

    const profiles = await client.execute("SELECT * FROM user_profiles WHERE LOWER(email) LIKE '%ramiro%'");
    console.log("\n=== USER PROFILES IN TURSO ===");
    console.log(profiles.rows);

    if (profiles.rows.length > 0) {
      const userJid = profiles.rows[0].user_id;
      const memberships = await client.execute({
        sql: "SELECT * FROM group_memberships WHERE user_id = ?",
        args: [userJid]
      });
      console.log(`\n=== GROUP MEMBERSHIPS IN TURSO FOR ${userJid} ===`);
      console.log(memberships.rows);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    client.close();
  }
}

run();
