import { z } from "zod";
import { SIGN_METHODS, SIGN_MODES, SIGN_SUBJECTS } from "./domain.js";

export const setSignConfigBody = z.object({
  mode:           z.enum(SIGN_MODES),
  allowedMethods: z.array(z.enum(SIGN_METHODS)).min(1).default(["aadhaar_esign", "dsc"]),
});
export type SetSignConfigBody = z.infer<typeof setSignConfigBody>;

export const signBody = z.object({
  subjectType: z.enum(SIGN_SUBJECTS),
  subjectId:   z.string().uuid(),
  method:      z.enum(SIGN_METHODS),
  // DSC desktop-signer path: the client posts the CMS produced on the device;
  // the server verifies it. Omitted for the Aadhaar eSign (server gateway) path.
  pkcs7:       z.string().min(1).optional(),
  certSubject: z.string().optional(),
  certIssuer:  z.string().optional(),
  certSerial:  z.string().optional(),
});
export type SignBody = z.infer<typeof signBody>;

export const subjectParams = z.object({
  subjectType: z.enum(SIGN_SUBJECTS),
  subjectId:   z.string().uuid(),
});
