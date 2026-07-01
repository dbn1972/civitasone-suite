import postgres from "postgres";
const url = process.env.DATABASE_URL || "postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_hrms";
const sql = postgres(url, { max: 1 });
// Drop old check constraint and add new one with all types
await sql.unsafe(`
ALTER TABLE employee.hrms_employees DROP CONSTRAINT IF EXISTS hrms_employees_employee_type_check;
ALTER TABLE employee.hrms_employees ADD CONSTRAINT hrms_employees_employee_type_check
  CHECK (employee_type IN ('permanent','temporary','contract','deputation','intern','apprentice','volunteer'));
`);
console.log("CHECK constraint updated to include intern/apprentice/volunteer");
await sql.end();
