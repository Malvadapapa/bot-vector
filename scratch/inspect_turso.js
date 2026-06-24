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
    
    console.log("\nQuery 1: SELECT * FROM teacher_messages WHERE target_id = ? OR target_id = ''");
    try {
      const res1 = await client.execute({
        sql: "SELECT * FROM teacher_messages WHERE target_id = ? OR target_id = ''",
        args: ["120363413138580513@g.us"]
      });
      console.log("Success! Row count:", res1.rows.length);
    } catch (err) {
      console.error("Error in Query 1:", err);
    }

    console.log("\nQuery 2: SELECT COUNT(*) as total, SUM(CASE WHEN read_by_professor = 0 AND is_from_student = 1 THEN 1 ELSE 0 END) as unread FROM teacher_message_replies");
    try {
      const res2 = await client.execute("SELECT COUNT(*) as total, SUM(CASE WHEN read_by_professor = 0 AND is_from_student = 1 THEN 1 ELSE 0 END) as unread FROM teacher_message_replies");
      console.log("Success! Row:", res2.rows[0]);
    } catch (err) {
      console.error("Error in Query 2:", err);
    }
  } catch (err) {
    console.error("General error:", err);
  } finally {
    client.close();
  }
}

run();
