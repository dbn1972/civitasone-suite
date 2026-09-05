import { signToken } from "@civitasone/auth";
const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const token = signToken({ sub: "user-001", tid: TENANT, roles: ["finance_officer","finance_admin"], sid: "sess-001" }, SECRET);
console.log(token);
