-- Add GoI reservation category and disability flag to employee master
ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS category     varchar(8)  CHECK (category IN ('UR','SC','ST','OBC','EWS')),
  ADD COLUMN IF NOT EXISTS disability   boolean     NOT NULL DEFAULT false;
