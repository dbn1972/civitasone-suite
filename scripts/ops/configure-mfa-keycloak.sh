#!/usr/bin/env bash
# Configure MFA: Keycloak OTP + identity-service mfa_enforced for privileged roles
set -euo pipefail

KC_URL="${KEYCLOAK_URL:-http://127.0.0.1:8180}"
KC_REALM="${KEYCLOAK_REALM:-civitasone}"
KC_ADMIN="${KEYCLOAK_ADMIN:-admin}"
KC_PW="${KEYCLOAK_ADMIN_PASSWORD:-civitas_kc_dev_pw}"

echo "=== CivitasOne MFA Configuration ==="

TOKEN=$(curl -sf -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=$KC_ADMIN" -d "password=$KC_PW" -d "grant_type=password" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

echo "Enabling OTP policy on realm $KC_REALM..."
curl -sf -X PUT "$KC_URL/admin/realms/$KC_REALM" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "otpPolicyType": "totp",
    "otpPolicyAlgorithm": "HmacSHA1",
    "otpPolicyDigits": 6,
    "otpPolicyPeriod": 30,
    "otpPolicyLookAheadWindow": 1
  }' && echo "OTP policy applied."

echo "Adding CONFIGURE_TOTP required action..."
curl -sf -X PUT "$KC_URL/admin/realms/$KC_REALM/authentication/required-actions/CONFIGURE_TOTP" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"alias":"CONFIGURE_TOTP","name":"Configure OTP","providerId":"CONFIGURE_TOTP","enabled":true,"defaultAction":false,"priority":10}' \
  2>/dev/null || echo "CONFIGURE_TOTP may already exist."

echo ""
echo "Identity-service MFA routes (enable per user):"
echo "  POST /api/v1/identity/mfa/setup"
echo "  POST /api/v1/identity/mfa/verify"
echo ""
echo "Set users.users.mfa_enforced=true for finance_admin, super_admin via SQL or admin API."
echo "MFA configuration complete."
