-- 0251_visiting_card_share_token.sql
--
-- Issue #1776: the unauthenticated QR/vCard route used to key on the guessable
-- employee number. Each card now carries an UNGUESSABLE share token
-- (256-bit, base64url, generated server-side with crypto.randomBytes), rotatable
-- and revocable (NULL = revoked) by the card owner.
--
-- Reviewed, narrowly scoped cross-tenant read: the public route sets the
-- transaction-local GUC app.visiting_card_token to the PRESENTED token and
-- nothing else. The SELECT-only policies below make visible exactly the one
-- card whose share_token equals that GUC, the employee it belongs to (not
-- separated/suspended) and that employee's department/designation rows. With the GUC
-- unset every added policy is false, so nothing is enumerable. No INSERT/
-- UPDATE/DELETE bypass is added; writes remain governed by tenant_isolation_policy.
-- Policies are OR-ed with the existing strict tenant policies (never replace them).
--
-- Additive + idempotent.
-- Rollback: DROP POLICY public_share_read ON hrms.visiting_cards;
--   DROP POLICY public_share_read ON employee.hrms_employees;
--   DROP POLICY public_share_read ON employee.hrms_departments;
--   DROP POLICY public_share_read ON employee.hrms_designations;
--   DROP INDEX hrms.visiting_cards_share_token_uq;
--   ALTER TABLE hrms.visiting_cards DROP COLUMN share_token, DROP COLUMN share_token_rotated_at;

SET lock_timeout = '5s';

ALTER TABLE hrms.visiting_cards ADD COLUMN IF NOT EXISTS share_token TEXT;
ALTER TABLE hrms.visiting_cards ADD COLUMN IF NOT EXISTS share_token_rotated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS visiting_cards_share_token_uq
  ON hrms.visiting_cards (share_token) WHERE share_token IS NOT NULL;

DROP POLICY IF EXISTS public_share_read ON hrms.visiting_cards;
CREATE POLICY public_share_read ON hrms.visiting_cards
  FOR SELECT
  USING (share_token IS NOT NULL
         AND share_token = current_setting('app.visiting_card_token', true));

DROP POLICY IF EXISTS public_share_read ON employee.hrms_employees;
CREATE POLICY public_share_read ON employee.hrms_employees
  FOR SELECT
  USING (status NOT IN ('separated', 'suspended', 'terminated', 'resigned', 'retired', 'deceased')
         AND EXISTS (SELECT 1 FROM hrms.visiting_cards vc
                      WHERE vc.employee_id = hrms_employees.id
                        AND vc.tenant_id = hrms_employees.tenant_id
                        AND vc.share_token IS NOT NULL
                        AND vc.share_token = current_setting('app.visiting_card_token', true)));

DROP POLICY IF EXISTS public_share_read ON employee.hrms_departments;
CREATE POLICY public_share_read ON employee.hrms_departments
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM employee.hrms_employees e
                  WHERE e.department_id = hrms_departments.id
                    AND e.tenant_id = hrms_departments.tenant_id));

DROP POLICY IF EXISTS public_share_read ON employee.hrms_designations;
CREATE POLICY public_share_read ON employee.hrms_designations
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM employee.hrms_employees e
                  WHERE e.designation_id = hrms_designations.id
                    AND e.tenant_id = hrms_designations.tenant_id));
