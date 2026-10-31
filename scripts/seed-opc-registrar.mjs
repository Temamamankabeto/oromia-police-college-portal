import pg from "pg";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const mode = process.argv[2] ?? "--dry-run";

if (!["--dry-run", "--apply"].includes(mode)) {
  throw new Error(
    "Usage: node scripts/seed-opc-registrar.mjs --dry-run|--apply"
  );
}

const catalogPath = resolve(
  process.cwd(),
  "database/seeds/opc-registrar.json"
);

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function nonEmpty(value, maxLength, field) {
  assert(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= maxLength,
    `Invalid ${field}`
  );
}

function validateCatalog(data) {
  assert(data && typeof data === "object", "Invalid catalog");
  assert(data.project?.project_code === "OPC-REG", "Invalid project code");
  assert(
    data.project.title ===
      "Oromia Police College Registrar Management System",
    "Unexpected project title"
  );
  assert(data.project.status === "ACTIVE", "Invalid project status");
  assert(data.specification_status === "DRAFT", "Specification must be DRAFT");

  nonEmpty(data.project.title, 255, "project title");
  nonEmpty(data.project.description, 5000, "project description");

  assert(Array.isArray(data.modules), "Missing modules");
  assert(data.modules.length === 18, "Expected 18 modules");

  const moduleCodes = new Set();
  const activityCodes = new Set();
  const requirementCodes = new Set();
  const objectiveCodes = new Set();

  let activityCount = 0;
  let requirementCount = 0;

  for (const [moduleIndex, module] of data.modules.entries()) {
    const expectedModuleCode =
      `OPC-M${String(moduleIndex + 1).padStart(2, "0")}`;

    assert(
      module.module_code === expectedModuleCode,
      `Unexpected module code: ${module.module_code}`
    );

    assert(
      !moduleCodes.has(module.module_code),
      `Duplicate module: ${module.module_code}`
    );

    moduleCodes.add(module.module_code);

    nonEmpty(module.title, 255, "module title");
    nonEmpty(module.description, 5000, "module description");

    assert(
      module.display_order === moduleIndex + 1,
      `Invalid module order: ${module.module_code}`
    );

    const objective = module.objective;

    assert(
      objective &&
        objective.objective_code ===
          `${module.module_code}-OBJ001`,
      `Invalid objective: ${module.module_code}`
    );

    assert(
      !objectiveCodes.has(objective.objective_code),
      `Duplicate objective: ${objective.objective_code}`
    );

    objectiveCodes.add(objective.objective_code);

    nonEmpty(objective.title, 255, "objective title");
    nonEmpty(objective.description, 10000, "objective description");

    assert(
      Array.isArray(module.activities) &&
        module.activities.length === 5,
      `Expected five activities in ${module.module_code}`
    );

    for (const [activityIndex, activity] of
      module.activities.entries()) {
      const expectedActivityCode =
        `${module.module_code}-A${String(activityIndex + 1).padStart(2, "0")}`;

      assert(
        activity.activity_code === expectedActivityCode,
        `Unexpected activity: ${activity.activity_code}`
      );

      assert(
        !activityCodes.has(activity.activity_code),
        `Duplicate activity: ${activity.activity_code}`
      );

      activityCodes.add(activity.activity_code);
      activityCount++;

      nonEmpty(activity.title, 255, "activity title");
      nonEmpty(activity.description, 10000, "activity description");

      assert(
        activity.display_order === activityIndex + 1,
        `Invalid activity order: ${activity.activity_code}`
      );

      assert(
        Array.isArray(activity.requirements) &&
          activity.requirements.length === 10,
        `Expected ten requirements in ${activity.activity_code}`
      );

      for (const [requirementIndex, requirement] of
        activity.requirements.entries()) {
        const expectedRequirementCode =
          `${activity.activity_code}-FR${String(requirementIndex + 1).padStart(3, "0")}`;

        assert(
          requirement.requirement_code === expectedRequirementCode,
          `Unexpected requirement: ${requirement.requirement_code}`
        );

        assert(
          !requirementCodes.has(requirement.requirement_code),
          `Duplicate requirement: ${requirement.requirement_code}`
        );

        requirementCodes.add(requirement.requirement_code);
        requirementCount++;

        nonEmpty(requirement.title, 255, "requirement title");
        nonEmpty(requirement.description, 50000, "requirement description");
        nonEmpty(
          requirement.acceptance_criteria,
          50000,
          "acceptance criteria"
        );

        assert(
          ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(
            requirement.priority
          ),
          `Invalid priority: ${requirement.requirement_code}`
        );

        assert(
          requirement.status === "DRAFT",
          `Requirement must be DRAFT: ${requirement.requirement_code}`
        );
      }
    }
  }

  assert(activityCount === 90, "Expected 90 activities");
  assert(requirementCount === 900, "Expected 900 requirements");

  return {
    modules: moduleCodes.size,
    objectives: objectiveCodes.size,
    activities: activityCount,
    requirements: requirementCount
  };
}

const expected = validateCatalog(catalog);

console.log("CATALOG_VALIDATED");
console.table(expected);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured.");
}

if (
  mode === "--apply" &&
  process.env.OPC_SEED_CONFIRM !== "YES"
) {
  throw new Error(
    "Apply requires OPC_SEED_CONFIRM=YES"
  );
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10000
});

const counts = {
  projects: 0,
  modules: 0,
  objectives: 0,
  activities: 0,
  requirements: 0,
  lifecycles: 0
};

let client;

try {
  client = await pool.connect();

  await client.query("BEGIN");

  await client.query(
    "SELECT pg_advisory_xact_lock($1, $2)",
    [72832, 2]
  );

  const existingProject = await client.query(
    `SELECT id, title, status, deleted_at
     FROM projects
     WHERE project_code = $1
     FOR UPDATE`,
    [catalog.project.project_code]
  );

  assert(
    existingProject.rowCount === 0,
    "OPC-REG already exists. Seeder will not overwrite it."
  );

  const existingModules = await client.query(
    `SELECT module_code
     FROM institutional_modules
     WHERE module_code = ANY($1::text[])`,
    [catalog.modules.map((module) => module.module_code)]
  );

  assert(
    existingModules.rowCount === 0,
    "One or more OPC-M01 through OPC-M18 module codes already exist."
  );

  const projectResult = await client.query(
    `INSERT INTO projects
       (project_code, title, description, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      catalog.project.project_code,
      catalog.project.title,
      catalog.project.description,
      catalog.project.status
    ]
  );

  const projectId = projectResult.rows[0].id;
  counts.projects++;

  for (const module of catalog.modules) {
    const moduleResult = await client.query(
      `INSERT INTO institutional_modules
         (project_id, module_code, title, description, display_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        projectId,
        module.module_code,
        module.title,
        module.description,
        module.display_order
      ]
    );

    const moduleId = moduleResult.rows[0].id;
    counts.modules++;

    await client.query(
      `INSERT INTO module_objectives
         (module_id, objective_code, title, description, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        moduleId,
        module.objective.objective_code,
        module.objective.title,
        module.objective.description,
        1
      ]
    );

    counts.objectives++;

    for (const activity of module.activities) {
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

      const activityId = activityResult.rows[0].id;
      counts.activities++;

      for (const [index, requirement] of
        activity.requirements.entries()) {
        const requirementResult = await client.query(
          `INSERT INTO activity_functional_requirements
             (module_id, activity_id, requirement_code, title,
              description, acceptance_criteria, priority,
              status, display_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            moduleId,
            activityId,
            requirement.requirement_code,
            requirement.title,
            requirement.description,
            requirement.acceptance_criteria,
            requirement.priority,
            requirement.status,
            index + 1
          ]
        );

        const requirementId = requirementResult.rows[0].id;
        counts.requirements++;

        await client.query(
          `INSERT INTO requirement_lifecycle
             (requirement_id, lifecycle_status)
           VALUES ($1, 'CREATED')`,
          [requirementId]
        );

        counts.lifecycles++;
      }
    }
  }

  for (const [key, value] of Object.entries(expected)) {
    assert(
      counts[key] === value,
      `Inserted ${key} count mismatch`
    );
  }

  assert(counts.projects === 1, "Project count mismatch");
  assert(counts.lifecycles === 900, "Lifecycle count mismatch");

  console.log("SEED_SUMMARY");
  console.table(counts);

  if (mode === "--apply") {
    await client.query("COMMIT");
    console.log("SEED_APPLIED_SUCCESSFULLY");
  } else {
    await client.query("ROLLBACK");
    console.log("DRY_RUN_COMPLETE_NO_CHANGES");
  }
} catch (error) {
  if (client) {
    await client.query("ROLLBACK").catch(() => {});
  }

  console.error("SEED_FAILED:", error.message);
  process.exitCode = 1;
} finally {
  if (client) {
    client.release();
  }

  await pool.end();
}