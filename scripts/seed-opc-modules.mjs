import pg from "pg";
import { readFile } from "node:fs/promises";

const mode = process.argv[2];
if (!["--dry-run", "--apply"].includes(mode)) {
  console.error("Usage: node scripts/seed-opc-modules.mjs --dry-run|--apply");
  process.exit(1);
}

const catalog = JSON.parse(
  await readFile("database/seeds/opc-32-modules.json", "utf8")
);

if (catalog.length !== 32 || catalog[0]?.module_code !== "M001") {
  throw new Error("Invalid 32-module catalog");
}

const codes = catalog.map((m) => m.module_code);
if (new Set(codes).size !== 32) {
  throw new Error("Duplicate module codes in catalog");
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10000
});

const counts = {
  modules: 0,
  objectives: 0,
  activities: 0,
  requirements: 0,
  skippedModules: 0
};

const client = await pool.connect();

try {
  await client.query("BEGIN");

  // Serialize concurrent executions of this seed.
  await client.query(
    "SELECT pg_advisory_xact_lock(72832, 1)"
  );

  for (const item of catalog) {
    // M001 is under review and must never be changed by this seed.
    if (item.module_code === "M001") {
      counts.skippedModules++;
      console.log("SKIP M001: protected existing proposal");
      continue;
    }

    const existing = await client.query(
      `SELECT m.id, m.title,
              COALESCE(r.approval_status, 'PENDING') AS status
       FROM institutional_modules m
       LEFT JOIN module_reviews r ON r.module_id = m.id
       WHERE m.module_code = $1`,
      [item.module_code]
    );

    let moduleId;

    if (existing.rowCount) {
      const row = existing.rows[0];

      if (row.title !== item.title) {
        throw new Error(
          `Conflicting title for ${item.module_code}: ${row.title}`
        );
      }

      // Never modify a previously created module.
      counts.skippedModules++;
      console.log(`SKIP ${item.module_code}: already exists (${row.status})`);
      continue;
    }

    const moduleResult = await client.query(
      `INSERT INTO institutional_modules
         (module_code, title, description, display_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        item.module_code,
        item.title,
        item.description,
        item.display_order
      ]
    );

    moduleId = moduleResult.rows[0].id;
    counts.modules++;

    const objective = item.objective;

    await client.query(
      `INSERT INTO module_objectives
         (module_id, objective_code, title, description, display_order)
       VALUES ($1, $2, $3, $4, 1)`,
      [
        moduleId,
        objective.objective_code,
        objective.title,
        objective.description
      ]
    );

    counts.objectives++;

    for (const activity of item.activities) {
      const activityResult = await client.query(
        `INSERT INTO module_activities
           (module_id, activity_code, title, description, display_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          moduleId,
          activity.activity_code,
          activity.title,
          activity.description,
          activity.display_order
        ]
      );

      counts.activities++;
      const activityId = activityResult.rows[0].id;

      for (const [index, req] of activity.requirements.entries()) {
        await client.query(
          `INSERT INTO activity_functional_requirements
             (module_id, activity_id, requirement_code, title,
              description, acceptance_criteria, priority,
              status, display_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            moduleId,
            activityId,
            req.requirement_code,
            req.title,
            req.description,
            req.acceptance_criteria,
            req.priority,
            req.status,
            index + 1
          ]
        );

        counts.requirements++;
      }
    }

    console.log(`PREPARED ${item.module_code}: ${item.title}`);
  }

  console.log("=== OPC SEED SUMMARY ===");
  console.table(counts);

  if (mode === "--apply") {
    if (process.env.OPC_SEED_CONFIRM !== "YES") {
      throw new Error(
        "Apply requires OPC_SEED_CONFIRM=YES"
      );
    }

    await client.query("COMMIT");
    console.log("SEED_APPLIED_SUCCESSFULLY");
  } else {
    await client.query("ROLLBACK");
    console.log("DRY_RUN_COMPLETE_NO_CHANGES");
  }
} catch (error) {
  await client.query("ROLLBACK");
  console.error("SEED_FAILED:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
